import { COW_VAULT_RELAYER, limitAppData } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { btAppDataHash as appDataHash } from "./blocktools.js";
import { createApp } from "./index.js";

const FEE = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const OWNER = "0x1111111111111111111111111111111111111111";
const env = { SWAPCHAN_FEE_RECIPIENT: FEE, SWAPCHAN_FEE_BPS: "10" } as NodeJS.ProcessEnv;

function mockCow() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
    if (url.endsWith("/quote")) return json({ quote: { buyAmount: "1000000", feeAmount: "5" } });
    if (url.includes("/app_data/")) return json(body.fullAppData ? "ok" : null);
    if (url.includes("/account/"))
      return json([
        {
          uid: "0xaa",
          status: "open",
          class: "limit",
          sellToken: USDC,
          buyToken: WETH,
          sellAmount: "1",
          buyAmount: "2",
          executedSellAmount: "0",
          executedBuyAmount: "0",
          validTo: 1,
          creationDate: "x",
          kind: "sell",
          fullAppData: '{"appCode":"SwapChan"}',
        },
        {
          uid: "0xbb",
          status: "fulfilled",
          class: "market",
          sellToken: USDC,
          buyToken: WETH,
          sellAmount: "1",
          buyAmount: "2",
          executedSellAmount: "1",
          executedBuyAmount: "2",
          validTo: 1,
          creationDate: "x",
          kind: "sell",
        },
      ]);
    if (url.endsWith("/orders") && init?.method === "POST") return json("0xuid", 201);
    if (url.endsWith("/orders") && init?.method === "DELETE") return json("Cancelled");
    return json({ description: "nope" }, 404);
  }) as typeof fetch;
  return { f, calls };
}
const app = (f: typeof fetch) => createApp([], { env, cowFetch: f, pricer: null, simulator: null });

describe("limit orders", () => {
  it("appData carries limit class + our 10 bp partner fee, hash = keccak of the doc", () => {
    const doc = limitAppData(FEE, 10);
    expect(JSON.parse(doc).metadata).toEqual({
      orderClass: { orderClass: "limit" },
      partnerFee: { volumeBps: 10, recipient: FEE },
    });
    expect(appDataHash(doc)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("builds EIP-712 typed data with our appData hash and uploads the doc", async () => {
    const { f, calls } = mockCow();
    const res = await app(f).request("/limit/build", {
      method: "POST",
      body: JSON.stringify({
        chainId: 8453,
        owner: OWNER,
        sellToken: USDC,
        buyToken: WETH,
        sellAmount: "100000000",
        buyAmount: "40000000000000000",
      }),
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    const hash = appDataHash(limitAppData(FEE, 10));
    expect(j.appDataHash).toBe(hash);
    expect(j.order.primaryType).toBe("Order");
    expect(j.order.domain).toMatchObject({ chainId: 8453, name: "Gnosis Protocol" });
    expect(j.order.message).toMatchObject({
      appData: hash,
      kind: "sell",
      feeAmount: "0",
      receiver: OWNER,
      buyAmount: "40000000000000000",
    });
    expect(j.approvalAddress).toBe(COW_VAULT_RELAYER);
    expect(j.partnerFee).toEqual({ volumeBps: 10, recipient: FEE });
    expect(j.market.buyAmount).toBe("999000"); // net of 10 bp
    expect(calls.find((c) => c.method === "PUT")?.url).toContain(`/app_data/${hash}`);
  });

  it("rejects native sells and unsupported chains", async () => {
    const { f } = mockCow();
    const base = { owner: OWNER, buyToken: WETH, sellAmount: "1", buyAmount: "1" };
    const native = await app(f).request("/limit/build", {
      method: "POST",
      body: JSON.stringify({
        ...base,
        chainId: 8453,
        sellToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      }),
    });
    expect(native.status).toBe(400);
    const op = await app(f).request("/limit/build", {
      method: "POST",
      body: JSON.stringify({ ...base, chainId: 10, sellToken: USDC }),
    });
    expect(op.status).toBe(400);
  });

  it("lists only limit orders, submits and cancels", async () => {
    const { f, calls } = mockCow();
    const a = app(f);
    const list = await (await a.request(`/limit/orders?chainId=8453&owner=${OWNER}`)).json();
    expect(list.map((o: { uid: string }) => o.uid)).toEqual(["0xaa"]);
    expect(list[0].viaSwapChan).toBe(true);
    const hash = appDataHash(limitAppData(FEE, 10));
    const bad = await a.request("/limit/submit", {
      method: "POST",
      body: JSON.stringify({
        chainId: 8453,
        owner: OWNER,
        order: { appData: "0x00" },
        signature: "0x12",
      }),
    });
    expect(bad.status).toBe(400);
    const ok = await a.request("/limit/submit", {
      method: "POST",
      body: JSON.stringify({
        chainId: 8453,
        owner: OWNER,
        order: { appData: hash },
        signature: "0x12",
      }),
    });
    expect((await ok.json()).uid).toBe("0xuid");
    const td = await (await a.request("/limit/cancel?chainId=8453&uid=0xaa")).json();
    expect(td.primaryType).toBe("OrderCancellations");
    expect(td.message.orderUids).toEqual(["0xaa"]);
    const c = await a.request("/limit/cancel", {
      method: "POST",
      body: JSON.stringify({ chainId: 8453, orderUids: ["0xaa"], signature: "0x12" }),
    });
    expect(c.status).toBe(200);
    expect(calls.at(-1)?.method).toBe("DELETE");
  });
});
