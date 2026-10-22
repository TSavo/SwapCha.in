import type { Quote, QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { createApp, rank } from "./index.js";
import { lifi } from "./providers/lifi.js";
import type { ProviderAdapter } from "./providers/types.js";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const LINK = "0x514910771af9ca656af840dff83e8264ecf986ca";
const req = {
  fromChainId: 1,
  toChainId: 1,
  fromToken: USDC,
  toToken: LINK,
  amount: "1000000",
  slippageBps: 50,
} as QuoteRequest;
const mk = (provider: string, toAmount: string, netUsd: number | null): Quote => ({
  id: `${provider}:1`,
  provider,
  request: req,
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
});
const fake = (q: Quote | Error): ProviderAdapter => ({
  name: q instanceof Error ? "bad" : q.provider,
  enabled: () => true,
  supports: () => true,
  quote: async () => {
    if (q instanceof Error) throw q;
    return q;
  },
});

describe("api", () => {
  it("ranks by netUsd then bigint toAmount", () => {
    const r = rank([
      mk("a", "5", null),
      mk("b", "1", 2),
      mk("c", "99999999999999999999", null),
      mk("d", "1", 3),
    ]);
    expect(r.map((q) => q.provider)).toEqual(["d", "b", "c", "a"]);
  });
  it("health", async () => {
    const res = await createApp([]).request("/health");
    expect(await res.json()).toMatchObject({ ok: true, version: "1" });
  });
  it("fans out, isolates provider errors", async () => {
    const app = createApp([fake(mk("x", "10", 1)), fake(new Error("boom"))]);
    const res = await app.request(
      `/quotes?${new URLSearchParams({ fromChainId: "1", toChainId: "1", fromToken: USDC, toToken: LINK, amount: "1000000" })}`,
    );
    const body = await res.json();
    expect(body.best).toBe("x:1");
    expect(body.errors).toEqual([{ provider: "bad", message: "boom" }]);
  });
  it("rejects float amounts", async () => {
    const res = await createApp([]).request(
      `/quotes?fromChainId=1&toChainId=1&fromToken=${USDC}&toToken=${LINK}&amount=1.5`,
    );
    expect(res.status).toBe(400);
  });
  it("normalizes a LI.FI response", async () => {
    const f = (async () =>
      Response.json({
        id: "abc",
        type: "lifi",
        tool: "uniswap",
        action: {
          fromChainId: 1,
          toChainId: 1,
          fromToken: { address: USDC },
          toToken: { address: LINK },
          fromAmount: "1000000",
        },
        estimate: {
          toAmount: "70000000000000000",
          toAmountMin: "69000000000000000",
          toAmountUSD: "0.99",
          executionDuration: 30,
          approvalAddress: LINK,
          gasCosts: [{ amountUSD: "0.10" }],
          feeCosts: [{ amountUSD: "0.01" }],
        },
        transactionRequest: {
          to: LINK,
          data: "0x12",
          value: "0x0",
          gasLimit: "0x5208",
          chainId: 1,
        },
      })) as unknown as typeof fetch;
    const q = await lifi({}, f).quote({ ...req, taker: LINK }, AbortSignal.timeout(1000));
    expect(q.netUsd).toBeCloseTo(0.88);
    expect(q.tx).toMatchObject({ value: "0", gasLimit: "21000" });
  });
});
