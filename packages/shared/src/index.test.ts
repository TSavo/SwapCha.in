import { describe, expect, it } from "vitest";
import { fromBaseUnits, NATIVE_TOKEN, QuoteRequest, toBaseUnits, tokenList } from "./index.js";

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

describe("chain registry", () => {
  it("lists BNB Chain tokens: BNB, WBNB, USDT, USDC, ETH", async () => {
    const { SUPPORTED_CHAINS } = await import("./index.js");
    expect(SUPPORTED_CHAINS[56].name).toBe("BNB Chain");
    const syms = tokenList.filter((t) => t.chainId === 56).map((t) => t.symbol);
    for (const s of ["BNB", "WBNB", "USDT", "USDC", "ETH"]) expect(syms).toContain(s);
  });
  it("has a native token and USDC on every supported chain", async () => {
    const { SUPPORTED_CHAINS } = await import("./index.js");
    for (const id of Object.keys(SUPPORTED_CHAINS).map(Number)) {
      const syms = tokenList.filter((t) => t.chainId === id);
      expect(syms.some((t) => t.address === NATIVE_TOKEN)).toBe(true);
      expect(syms.some((t) => t.symbol === "USDC")).toBe(true);
    }
  });
});
