import type { QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { rank } from "./aggregate.js";
import type { Pricer } from "./pricing.js";
import { across } from "./providers/across.js";
import { cow } from "./providers/cow.js";
import { lifi } from "./providers/lifi.js";
import { relay } from "./providers/relay.js";
import { velora } from "./providers/velora.js";
import { zerox } from "./providers/zerox.js";

const R = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const env = { SWAPCHAN_FEE_RECIPIENT: R, SWAPCHAN_FEE_BPS: "10", ZEROX_API_KEY: "k" };
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const TAKER = "0x1111111111111111111111111111111111111111";
const req = {
  fromChainId: 1,
  toChainId: 1,
  fromToken: USDC,
  toToken: USDT,
  amount: "100000000",
  slippageBps: 50,
  taker: TAKER,
} as QuoteRequest;
const xreq = { ...req, toChainId: 8453 } as QuoteRequest;
const pricer: Pricer = {
  token: async () => ({ priceUsd: 1, decimals: 6 }),
  usd: async (_c, _a, amt) => Number(amt) / 1e6,
};
const sig = () => AbortSignal.timeout(1000);
const rec = (...bodies: unknown[]) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const b = bodies[Math.min(calls.length - 1, bodies.length - 1)];
    return b instanceof Response ? b : Response.json(b);
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe("our fee is requested and verified per provider", () => {
  it("cow: partnerFee appData, hash signed, buy amount net of fee", async () => {
    const quote = {
      sellToken: USDC,
      buyToken: USDT,
      sellAmount: "99800000",
      buyAmount: "100000000",
      validTo: 2e9,
      appData: '{"metadata":{"partnerFee":{}}}',
      appDataHash: "0xabc",
      feeAmount: "200000",
      kind: "sell",
      partiallyFillable: false,
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
    };
    const { f, calls } = rec({ id: 1, quote }, {});
    const q = await cow(pricer, f, env).quote(req, sig());
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(JSON.parse(body.appData).metadata.partnerFee).toEqual({ volumeBps: 10, recipient: R });
    expect(calls[1]?.url).toContain("/app_data/0xabc");
    expect(q.order?.message.appData).toBe("0xabc");
    expect(q.toAmount).toBe("99900000");
    expect(q.ourFeeUsd).toBeCloseTo(0.1);
    expect(q.ourFeeVerified).toBe(true);
  });
  it("across: appFee + appFeeRecipient, fee read from response", async () => {
    const { f, calls } = rec({
      id: "a",
      expectedOutputAmount: "99800000",
      minOutputAmount: "99000000",
      expectedFillTime: 2,
      quoteExpiryTimestamp: 2e9,
      fees: { total: { details: { app: { amount: "100000", amountUsd: "0.1" } } } },
      swapTx: { chainId: 1, to: TAKER, data: "0x" },
    });
    const q = await across(pricer, f, env).quote(xreq, sig());
    expect(calls[0]?.url).toContain("appFee=0.001");
    expect(calls[0]?.url).toContain(`appFeeRecipient=${R}`);
    expect(q.ourFeeUsd).toBeCloseTo(0.1);
    expect(q.ourFeeVerified).toBe(true);
  });
  it("relay: appFees in body, fees.app verified", async () => {
    const { f, calls } = rec({
      steps: [
        { id: "deposit", items: [{ data: { to: TAKER, data: "0x", value: "0", chainId: 1 } }] },
      ],
      fees: { app: { amount: "100000", amountUsd: "0.1" } },
      details: { currencyOut: { amount: "99800000", amountUsd: "99.8" } },
    });
    const q = await relay(env, f).quote(xreq, sig());
    expect(JSON.parse(String(calls[0]?.init?.body)).appFees).toEqual([{ recipient: R, fee: "10" }]);
    expect(q.ourFeeVerified).toBe(true);
    expect(q.ourFeeUsd).toBeCloseTo(0.1);
  });
  it("0x: swapFeeBps/Recipient, integratorFee verified", async () => {
    const { f, calls } = rec({
      buyAmount: "99800000",
      minBuyAmount: "99000000",
      fees: { integratorFee: { amount: "100000", token: USDT } },
      transaction: { to: TAKER, data: "0x", value: "0" },
    });
    const q = await zerox(env, pricer, f).quote(req, sig());
    expect(calls[0]?.url).toContain("swapFeeBps=10");
    expect(calls[0]?.url).toContain(`swapFeeRecipient=${R}`);
    expect(q.ourFeeVerified).toBe(true);
  });
  it("lifi: requests fee; falls back unverified on 1011", async () => {
    const step = {
      id: "s",
      type: "lifi",
      tool: "x",
      action: {
        fromChainId: 1,
        toChainId: 8453,
        fromToken: { address: USDC },
        toToken: { address: USDT },
        fromAmount: "100000000",
      },
      estimate: {
        toAmount: "99000000",
        toAmountMin: "98000000",
        toAmountUSD: "99",
        executionDuration: 10,
      },
    };
    const bad = rec(
      new Response('{"code":1011,"message":"not configured for collecting fees"}', { status: 400 }),
      step,
    );
    const q = await lifi(env, bad.f).quote(xreq, sig());
    expect(bad.calls[0]?.url).toContain("fee=0.001");
    expect(bad.calls[1]?.url).not.toContain("fee=");
    expect(q.ourFeeVerified).toBe(false);
    const fs = {
      ...step,
      includedSteps: [
        {
          ...step,
          tool: "feeCollection",
          estimate: {
            ...step.estimate,
            feeCosts: [{ amountUSD: "0.35", percentage: "0.0035", included: true }],
          },
        },
      ],
    };
    const ok = rec(fs);
    const q2 = await lifi(env, ok.f).quote(xreq, sig());
    expect(q2.ourFeeVerified).toBe(true);
    expect(q2.ourFeeUsd).toBeCloseTo(0.1);
  });
  it("velora: partner fee params present", async () => {
    expect(velora).toBeTypeOf("function"); // covered in providers.test.ts (partnerFeeBps)
  });
  it("rank: fee-less route must beat fee routes by more than our cut", () => {
    const base = {
      request: req,
      toAmount: "1",
      toAmountMin: "1",
      gasUsd: 0,
      feeUsd: 0,
      etaSeconds: 1,
      steps: [],
      approvalAddress: null,
      tx: null,
      expiresAt: 0,
    };
    const paid = { ...base, id: "p", provider: "p", netUsd: 99.95, ourFeeVerified: true };
    const free = { ...base, id: "f", provider: "f", netUsd: 100, ourFeeVerified: false };
    expect(rank([free, paid], 10)[0]?.id).toBe("p");
    expect(rank([free, paid], 0)[0]?.id).toBe("f");
  });
});

describe("ranking ignores provider-reported USD", () => {
  it("a provider inflating its USD does not beat routes that give more tokens", async () => {
    const { fanOut } = await import("./aggregate.js");
    const mk = (name: string, toAmount: string, netUsd: number) => ({
      name,
      enabled: () => true,
      supports: () => true,
      quote: async (r: QuoteRequest) => ({
        id: `${name}:1`,
        provider: name,
        request: r,
        toAmount,
        toAmountMin: toAmount,
        gasUsd: 0,
        feeUsd: 0,
        netUsd,
        etaSeconds: 1,
        steps: [],
        approvalAddress: null,
        tx: null,
        expiresAt: 0,
        ourFeeUsd: 0.1,
        ourFeeVerified: true,
      }),
    });
    const res = await fanOut(
      [mk("liar", "99636000", 100.87), mk("honest", "99884000", 99.85)],
      xreq,
      1000,
      10,
      pricer,
    );
    expect(res.quotes[0]?.provider).toBe("honest");
    expect(res.quotes[0]?.netUsd).toBeCloseTo(99.884);
    expect(res.quotes[1]?.netUsd).toBeCloseTo(99.636);
  });
});
