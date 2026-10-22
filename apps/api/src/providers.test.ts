import type { QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import type { Pricer } from "./pricing.js";
import { across } from "./providers/across.js";
import { cow } from "./providers/cow.js";
import { lifi } from "./providers/lifi.js";
import { relay } from "./providers/relay.js";
import { velora } from "./providers/velora.js";
import { zerox } from "./providers/zerox.js";
import { createSimulator } from "./simulate.js";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const LINK = "0x514910771af9ca656af840dff83e8264ecf986ca";
const TAKER = "0x1111111111111111111111111111111111111111";
const req = {
  fromChainId: 1,
  toChainId: 1,
  fromToken: USDC,
  toToken: LINK,
  amount: "100000000",
  slippageBps: 50,
} as QuoteRequest;
const xreq = { ...req, toChainId: 8453 } as QuoteRequest;
const sig = () => AbortSignal.timeout(1000);
// LINK = $10 (18 dec), USDC = $1 (6 dec), ETH = $2000
const pricer: Pricer = {
  token: async (_c, a) => ({
    priceUsd: a === LINK ? 10 : a === USDC ? 1 : 2000,
    decimals: a === USDC ? 6 : 18,
  }),
  usd: async (_c, a, amt) =>
    (Number(amt) / 10 ** (a === USDC ? 6 : 18)) * (a === LINK ? 10 : a === USDC ? 1 : 2000),
};
const fetchJson = (...bodies: unknown[]) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return Response.json(bodies[Math.min(calls.length - 1, bodies.length - 1)]);
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe("providers", () => {
  it("cow: priced signed-order quote, no tx, skips native/cross-chain", async () => {
    const { f, calls } = fetchJson({
      id: 7,
      quote: {
        sellToken: USDC,
        buyToken: LINK,
        sellAmount: "99800000",
        buyAmount: "9000000000000000000",
        validTo: 2_000_000_000,
        appData: "0x00",
        feeAmount: "200000",
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      },
    });
    const p = cow(pricer, f);
    expect(p.supports(xreq)).toBe(false);
    expect(
      p.supports({
        ...req,
        fromToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      } as QuoteRequest),
    ).toBe(false);
    const q = await p.quote(req, sig());
    expect(calls[0]?.url).toBe("https://api.cow.fi/mainnet/api/v1/quote");
    expect(q).toMatchObject({
      execution: "order",
      tx: null,
      netUsd: 90,
      feeUsd: 0.2,
      toAmountMin: "8955000000000000000",
    });
    expect(q.order?.message).toMatchObject({ feeAmount: "0", sellAmount: "100000000" });
  });
  it("velora: price + tx build with taker", async () => {
    const { f, calls } = fetchJson(
      {
        priceRoute: {
          destAmount: "9000000000000000000",
          gasCostUSD: "0.5",
          destUSD: "90",
          tokenTransferProxy: LINK,
          bestRoute: [{ swaps: [{ swapExchanges: [{ exchange: "UniswapV3" }] }] }],
        },
      },
      { to: LINK, data: "0xab", value: "0", gas: "200000", chainId: 1 },
    );
    const q = await velora(pricer, {}, f).quote({ ...req, taker: TAKER }, sig());
    expect(calls[0]?.url).toContain("srcDecimals=6");
    expect(q).toMatchObject({
      netUsd: 89.5,
      gasUsd: 0.5,
      approvalAddress: LINK,
      tx: { gasLimit: "200000" },
    });
    expect(q.steps[0]?.tool).toBe("UniswapV3");
  });
  it("across: cross-chain only, fee from USD delta", async () => {
    const { f } = fetchJson({
      id: "a1",
      expectedOutputAmount: "99000000",
      minOutputAmount: "98900000",
      expectedFillTime: 2,
      quoteExpiryTimestamp: 2_000_000_000,
      checks: { allowance: { spender: LINK } },
      swapTx: { chainId: 1, to: LINK, data: "0x01" },
    });
    const p = across(pricer, f);
    expect(p.supports(req)).toBe(false);
    const q = await p.quote({ ...xreq, toToken: USDC }, sig());
    expect(q.netUsd).toBeCloseTo(99);
    expect(q.feeUsd).toBeCloseTo(1);
    expect(q.tx).toBeNull();
  });
  it("relay: maps fees, approval spender, tx, native sentinel", async () => {
    const spender = "4cd00e387622c35bddb9b4c962c136462338bc31";
    const { f, calls } = fetchJson({
      requestId: "0xr",
      fees: {
        gas: { amount: "1", amountUsd: "0.03" },
        relayer: { amount: "1", amountUsd: "0.02" },
      },
      details: {
        currencyOut: { amount: "99900000", amountUsd: "99.9", minimumAmount: "99400000" },
        timeEstimate: 3,
      },
      steps: [
        {
          id: "approve",
          kind: "transaction",
          items: [
            {
              data: {
                to: USDC,
                data: `0x095ea7b3000000000000000000000000${spender}${"0".repeat(64)}`,
                value: "0",
                chainId: 1,
              },
            },
          ],
        },
        {
          id: "deposit",
          kind: "transaction",
          items: [{ data: { to: LINK, data: "0x02", value: "0", chainId: 1, gas: "90000" } }],
        },
      ],
    });
    const q = await relay({}, f).quote(
      {
        ...xreq,
        fromToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        taker: TAKER,
      } as QuoteRequest,
      sig(),
    );
    expect(JSON.parse(String(calls[0]?.init?.body)).originCurrency).toBe(
      "0x0000000000000000000000000000000000000000",
    );
    expect(q).toMatchObject({
      id: "relay:0xr",
      netUsd: 99.87,
      feeUsd: 0.02,
      approvalAddress: `0x${spender}`,
      tx: { to: LINK, gasLimit: "90000" },
    });
  });
  it("0x: disabled without key; USD-priced; build returns permit2 typed data", async () => {
    expect(zerox({}, pricer).enabled()).toBe(false);
    const eip712 = {
      domain: { name: "Permit2" },
      types: { PermitTransferFrom: [{ name: "nonce", type: "uint256" }] },
      primaryType: "PermitTransferFrom",
      message: { nonce: "1" },
    };
    const { f } = fetchJson({
      buyAmount: "9000000000000000000",
      minBuyAmount: "8900000000000000000",
      totalNetworkFee: "500000000000000",
      transaction: { to: LINK, data: "0x03", value: "0", gas: "150000" },
      permit2: { eip712 },
    });
    const p = zerox({ ZEROX_API_KEY: "k" }, pricer, f);
    const q = await p.quote(req, sig());
    expect(q.netUsd).toBeCloseTo(89);
    expect(q.gasUsd).toBeCloseTo(1);
    const b = await p.build?.({ ...req, taker: TAKER }, sig());
    expect(b?.permit2?.primaryType).toBe("PermitTransferFrom");
  });
  it("lifi: feeCollection step is labeled fee", async () => {
    const st = (tool: string, type: string) => ({
      id: "s",
      type,
      tool,
      action: {
        fromChainId: 1,
        toChainId: 1,
        fromToken: { address: USDC },
        toToken: { address: LINK },
        fromAmount: "1",
      },
      estimate: { toAmount: "1", toAmountMin: "1", executionDuration: 1 },
    });
    const { f } = fetchJson({
      ...st("x", "lifi"),
      includedSteps: [st("feeCollection", "protocol"), st("uniswap", "swap")],
    });
    const q = await lifi({}, f).quote(req, sig());
    expect(q.steps.map((s) => s.type)).toEqual(["fee", "swap"]);
  });
});

describe("auth + rate limit", () => {
  const env = { SWAPCHAN_API_KEYS: "k1:2" };
  it("open dev mode without keys", async () => {
    expect((await createApp([], { env: {}, simulator: null }).request("/chains")).status).toBe(200);
  });
  it("401 without key, health exempt, 429 over limit", async () => {
    const app = createApp([], { env, simulator: null });
    expect((await app.request("/chains")).status).toBe(401);
    expect((await app.request("/health")).status).toBe(200);
    const h = { "x-api-key": "k1" };
    expect((await app.request("/chains", { headers: h })).status).toBe(200);
    expect((await app.request("/chains", { headers: { authorization: "Bearer k1" } })).status).toBe(
      200,
    );
    const r = await app.request("/chains", { headers: h });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });
});

describe("simulation", () => {
  it("off by default; tenderly needs keys", () => {
    expect(createSimulator({})).toBeNull();
    expect(createSimulator({ SWAPCHAN_SIMULATE: "tenderly" })).toBeNull();
  });
  it("tenderly result mapped", async () => {
    const { f, calls } = fetchJson({
      transaction: { status: false, gas_used: 21000, error_message: "revert" },
    });
    const sim = createSimulator(
      {
        SWAPCHAN_SIMULATE: "tenderly",
        TENDERLY_ACCOUNT: "a",
        TENDERLY_PROJECT: "p",
        TENDERLY_ACCESS_KEY: "k",
      },
      f,
    );
    const r = await sim?.({ chainId: 1, to: LINK, data: "0x", value: "0" }, TAKER);
    expect(calls[0]?.url).toContain("/account/a/project/p/simulate");
    expect(r).toEqual({ ok: false, method: "tenderly", gasUsed: "21000", error: "revert" });
  });
  it("/build attaches simulation", async () => {
    const tx = { chainId: 1, to: LINK, data: "0x01", value: "0" } as const;
    const base = {
      id: "p:1",
      provider: "p",
      request: req,
      toAmount: "1",
      toAmountMin: "1",
      gasUsd: 0,
      feeUsd: 0,
      netUsd: 1,
      etaSeconds: 1,
      steps: [],
      approvalAddress: null,
      expiresAt: 0,
    };
    const p = {
      name: "p",
      enabled: () => true,
      supports: () => true,
      quote: async (r: QuoteRequest) => ({ ...base, tx: r.taker ? tx : null }),
    };
    const app = createApp([p], {
      env: {},
      simulator: async () => ({ ok: true, method: "eth_call", gasUsed: "50000" }),
    });
    await app.request(
      `/quotes?fromChainId=1&toChainId=1&fromToken=${USDC}&toToken=${LINK}&amount=1`,
    );
    const r = await app.request("/build", {
      method: "POST",
      body: JSON.stringify({ quoteId: "p:1", taker: TAKER }),
      headers: { "content-type": "application/json" },
    });
    expect(await r.json()).toMatchObject({
      ...tx,
      execution: "tx",
      simulation: { ok: true, gasUsed: "50000" },
    });
  });
});

describe("pricing", () => {
  it("llama pricer: token + native ids, caches", async () => {
    const { llamaPricer } = await import("./pricing.js");
    const { f, calls } = fetchJson(
      { coins: { [`ethereum:${USDC}`]: { price: 1, decimals: 6 } } },
      { coins: { "coingecko:ethereum": { price: 2000 } } },
    );
    const p = llamaPricer(f);
    expect(await p.usd(1, USDC, "2500000")).toBe(2.5);
    expect(await p.usd(1, USDC, "1000000")).toBe(1);
    expect(
      await p.usd(8453, "0x0000000000000000000000000000000000000000", "500000000000000000"),
    ).toBe(1000);
    expect(calls.map((c) => c.url)).toEqual([
      `https://coins.llama.fi/prices/current/ethereum:${USDC}`,
      "https://coins.llama.fi/prices/current/coingecko:ethereum",
    ]);
  });
});
