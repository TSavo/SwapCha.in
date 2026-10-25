import { describe, expect, it } from "vitest";
import { sanePx } from "./onchain.js";

describe("sanePx", () => {
  it("drops absurd non-BTC price", () => {
    const r = sanePx({ price: 50614, symbol: "HAY", confidence: 0.99, decimals: 18 });
    expect(r.price).toBeUndefined();
    expect(r.unverified).toBe(true);
    expect(r.decimals).toBe(18);
  });
  it("keeps WBTC", () => expect(sanePx({ price: 95000, symbol: "WBTC" }).price).toBe(95000));
  it("keeps ETH", () =>
    expect(sanePx({ price: 3500, symbol: "WETH", confidence: 0.99 }).price).toBe(3500));
  it("drops low confidence", () =>
    expect(sanePx({ price: 1, symbol: "X", confidence: 0.2 }).price).toBeUndefined());
});
