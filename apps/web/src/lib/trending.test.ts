import { describe, expect, it } from "vitest";
import { ROUTES } from "./routes";
import { inputFor, parseTrendSlug, type TrendToken, trendSlugs } from "./trending";

const tok = (chain: TrendToken["chain"], chainId: number): TrendToken => ({
  key: "wif",
  chain,
  chainId,
  address: "X",
  symbol: "WIF",
  name: "dogwifhat",
  imageUrl: null,
  riskLevel: "low",
  riskFlags: [],
  liquidityUsd: 1e6,
  volume24hUsd: 1e6,
  indexable: true,
  firstSeen: 0,
  lastSeen: 0,
});

describe("trending slugs", () => {
  it("round-trips and never collides with static routes", () => {
    const s = trendSlugs(tok("solana", 792703809));
    expect(s).toEqual(["sol-to-wif", "usdc-to-wif"]);
    expect(parseTrendSlug("sol-to-wif")).toEqual({ from: "sol", key: "wif" });
    expect(parseTrendSlug("wif-to-sol")).toBeNull();
    // static slugs are chain-qualified (e.g. sol-solana-to-...), so a static slug never parses as a token key that exists
    expect(ROUTES.some((r) => /^(sol|eth|bnb|usdc)-to-/.test(r.slug))).toBe(false);
  });
  it("picks the right input token per chain", () => {
    expect(inputFor(tok("base", 8453), "eth")?.symbol).toBe("ETH");
    expect(inputFor(tok("base", 8453), "sol")).toBeNull();
    expect(inputFor(tok("solana", 792703809), "usdc")?.symbol).toBe("USDC");
    expect(inputFor(tok("bnb", 56), "bnb")?.amount).toBe("0.2");
  });
});
