import { NATIVE_TOKEN, QuotesResponse } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { mockQuotes, mockTokens } from "./mock";

describe("mock api", () => {
  it("returns contract-valid quotes ranked by netUsd", () => {
    const usdc = mockTokens(8453).find((t) => t.symbol === "USDC");
    const res = mockQuotes({
      fromChainId: 1,
      toChainId: usdc?.chainId ?? 8453,
      fromToken: NATIVE_TOKEN,
      toToken: usdc?.address ?? NATIVE_TOKEN,
      amount: "1500000000000000000",
      slippageBps: 50,
    });
    expect(() => QuotesResponse.parse(res)).not.toThrow();
    expect(res.quotes.length).toBeGreaterThan(0);
    const nets = res.quotes.map((q) => q.netUsd ?? 0);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);
    expect(res.best).toBe(res.quotes[0]?.id);
  });
});
