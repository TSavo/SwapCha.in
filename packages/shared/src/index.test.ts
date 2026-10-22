import { describe, expect, it } from "vitest";
import { fromBaseUnits, QuoteRequest, toBaseUnits, tokenList } from "./index.js";

describe("shared", () => {
  it("does exact decimal math (old bug: '1.5' padded wrong)", () => {
    expect(toBaseUnits("1.5", 6)).toBe(1_500_000n);
    expect(fromBaseUnits("1500000000000000000", 18)).toBe("1.5");
  });
  it("parses token list", () => expect(tokenList.length).toBeGreaterThan(5));
  it("validates quote requests", () => {
    const r = QuoteRequest.parse({
      fromChainId: "1",
      toChainId: 8453,
      amount: "1000",
      fromToken: tokenList[0]?.address,
      toToken: tokenList[1]?.address,
    });
    expect(r.slippageBps).toBe(50);
    expect(() => QuoteRequest.parse({ ...r, amount: "1.5" })).toThrow();
  });
});
