import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GuardCtx } from "./ctx.js";
import { type Payload, verifyPayload } from "./index.js";
import { relayProtocolFromChains } from "./relay.js";

// Real api.relay.link /quote (includeProtocolData) + /chains responses, Base -> Arbitrum.
const FX = JSON.parse(
  readFileSync(new URL("./fixtures/relay-base-arb.json", import.meta.url), "utf8"),
);
const TAKER = "0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b";
const EVIL = "0x000000000000000000000000000000000000dead";
const DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

const ctx: GuardCtx = {
  thorInbound: async () => [],
  relay: async () => ({ contracts: [DEPOSITORY], solvers: [] }),
  zeroxSettlers: async () => [],
  relayProtocol: async () => relayProtocolFromChains(FX.chains),
};

function payload(kind: "native" | "erc20", mut?: (q: any) => void): Payload {
  const q = structuredClone(FX[kind]);
  mut?.(q);
  const dep = q.steps.find((s: any) => s.id === "deposit").items[0].data;
  const native = kind === "native";
  return {
    provider: "relay",
    req: {
      fromChainId: 8453,
      toChainId: 42161,
      fromToken: native ? NATIVE : USDC_BASE,
      toToken: native ? NATIVE : USDC_ARB,
      amount: native ? "1000000000000000" : "5000000",
      taker: TAKER,
      slippageBps: 50,
    } as Payload["req"],
    toAmount: q.details.currencyOut.amount,
    approvalAddress: native ? null : DEPOSITORY,
    tx: { chainId: 8453, to: dep.to, data: dep.data, value: dep.value ?? "0" },
    relayOrder: q.protocol
      ? { orderId: q.protocol.v2.orderId, orderData: q.protocol.v2.orderData }
      : undefined,
  } as Payload;
}
const failed = async (p: Payload) =>
  (await verifyPayload(p, ctx)).checks.filter((c) => !c.ok).map((c) => c.name);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T16:00:00Z")); // before the fixture orders' deadline
});
afterAll(() => vi.useRealTimers());

describe("Relay order verification", () => {
  it("accepts honest native and ERC-20 deposits (full: recipient + minOut verified)", async () => {
    for (const k of ["native", "erc20"] as const) {
      const v = await verifyPayload(payload(k), ctx);
      expect(v.checks.filter((c) => !c.ok)).toEqual([]);
      expect(v.verified).toBe(true);
      expect(v.level).toBe("full");
    }
  });
  it("rejects a deposit without protocol order data (fail closed)", async () => {
    expect(await failed(payload("native", (q) => delete q.protocol))).toContain("relayOrder");
  });
  it("rejects a tampered recipient (order id no longer matches)", async () => {
    expect(
      await failed(
        payload("native", (q) => (q.protocol.v2.orderData.output.payments[0].recipient = EVIL)),
      ),
    ).toContain("relayOrder");
  });
  it("rejects a consistent order paying someone else", async () => {
    const p = payload("native");
    const v = await verifyPayload(
      { ...p, req: { ...p.req, recipient: EVIL } as Payload["req"] },
      ctx,
    );
    expect(v.checks.filter((c) => !c.ok).map((c) => c.name)).toContain("recipient");
  });
  it("rejects an order whose minimum output is below the quote bound", async () => {
    const p = payload("erc20");
    const v = await verifyPayload({ ...p, toAmount: "6000000" }, ctx);
    expect(v.checks.filter((c) => !c.ok).map((c) => c.name)).toContain("minOut");
  });
  it("rejects a deposit committing to a different order id", async () => {
    expect(
      await failed(
        payload("native", (q) => {
          const d = q.steps[0].items[0].data;
          d.data = d.data.slice(0, -64) + "11".repeat(32);
        }),
      ),
    ).toContain("orderBinding");
  });
  it("rejects a deposit to a non-canonical depository", async () => {
    const p = payload("native");
    const c2: GuardCtx = {
      ...ctx,
      relay: async () => ({ contracts: [DEPOSITORY, EVIL], solvers: [] }),
    };
    const v = await verifyPayload({ ...p, tx: { ...p.tx!, to: EVIL } }, c2);
    expect(v.checks.filter((c) => !c.ok).map((c) => c.name)).toContain("depository");
  });
  it("rejects when Relay chain metadata is unavailable", async () => {
    const v = await verifyPayload(payload("native"), {
      ...ctx,
      relayProtocol: async () => {
        throw new Error("down");
      },
    });
    expect(v.verified).toBe(false);
  });
  it("rejects an expired order", async () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    expect(await failed(payload("native"))).toContain("deadline");
    vi.setSystemTime(new Date("2026-10-24T16:00:00Z"));
  });
});
