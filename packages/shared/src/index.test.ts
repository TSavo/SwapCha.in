import { describe, expect, it } from "vitest";
import {
  fromBaseUnits,
  isVmAddress,
  NATIVE_TOKEN,
  nativeOf,
  QuoteRequest,
  toBaseUnits,
  tokenList,
  vmOf,
} from "./index.js";

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
      expect(syms.some((t) => t.address === nativeOf(id))).toBe(true);
      if (vmOf(id) === "evm" || vmOf(id) === "svm")
        expect(syms.some((t) => t.symbol === "USDC")).toBe(true);
    }
  });
  it("knows non-EVM chains and validates their addresses", () => {
    expect(vmOf(792703809)).toBe("svm");
    expect(vmOf(8253038)).toBe("bvm");
    expect(vmOf(728126428)).toBe("tvm");
    expect(vmOf(1)).toBe("evm");
    expect(isVmAddress("BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE", "svm")).toBe(true);
    expect(isVmAddress("bc1qy65xajxwrtp62uk3styn9py7m2k06cdj2wla6n", "bvm")).toBe(true);
    expect(isVmAddress("TULPYGfQ8U44XkhiX3oa3BaXdNPu6M5U3Z", "tvm")).toBe(true);
    expect(isVmAddress("TULPYGfQ8U44XkhiX3oa3BaXdNPu6M5U3Z", "bvm")).toBe(false);
    expect(nativeOf(8253038)).toMatch(/^bc1q/);
    const r = QuoteRequest.parse({
      fromChainId: 8453,
      toChainId: 792703809,
      amount: "1",
      fromToken: NATIVE_TOKEN,
      toToken: nativeOf(792703809),
      recipient: "BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE",
    });
    expect(r.recipient).toBe("BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE");
  });
});
