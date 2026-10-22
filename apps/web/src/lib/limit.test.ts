import { describe, expect, it } from "vitest";
import { buyForPrice, priceOf } from "./limit";

describe("limit price math", () => {
  it("converts price to buyAmount exactly", () => {
    // 100 USDC (6) at 0.0004 WETH/USDC -> 0.04 WETH (18)
    expect(buyForPrice(100_000_000n, 6, 18, "0.0004")).toBe(40_000_000_000_000_000n);
    // 1 WETH at 2500.5 USDC
    expect(buyForPrice(10n ** 18n, 18, 6, "2500.5")).toBe(2_500_500_000n);
    expect(buyForPrice(1n, 6, 6, "abc")).toBeNull();
  });
  it("prints a price", () => {
    expect(priceOf(10n ** 18n, 18, 2_500_500_000n, 6)).toBe("2500.5");
    expect(priceOf(100_000_000n, 6, 40_000_000_000_000_000n, 18)).toBe("0.0004");
  });
});
