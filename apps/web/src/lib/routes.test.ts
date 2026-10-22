import { describe, expect, it } from "vitest";
import { castOrder } from "./bios";
import { chainKey, deepLink, faq, ROUTES, related, routeBySlug, title } from "./routes";

describe("SEO routes", () => {
  it("has hundreds of unique, well-formed slugs", () => {
    expect(ROUTES.length).toBeGreaterThan(200);
    expect(new Set(ROUTES.map((r) => r.slug)).size).toBe(ROUTES.length);
    for (const r of ROUTES) expect(r.slug).toMatch(/^[a-z0-9.]+-[a-z]+-to-[a-z0-9.]+-[a-z]+$/);
  });
  it("titles are unique and chains map to cast pages", () => {
    expect(new Set(ROUTES.map(title)).size).toBe(ROUTES.length);
    for (const r of ROUTES) {
      expect(castOrder).toContain(chainKey(r.fromChainId));
      expect(castOrder).toContain(chainKey(r.toChainId));
    }
  });
  it("builds deep links, FAQ and related links", () => {
    const r = routeBySlug("usdc-base-to-sol-solana");
    expect(r).toBeDefined();
    if (!r) return;
    expect(title(r)).toBe("Cheapest way to swap USDC on Base to SOL on Solana");
    expect(deepLink(r)).toContain("fromChain=8453");
    expect(deepLink(r)).toContain("toChain=792703809");
    expect(faq(r).length).toBeGreaterThanOrEqual(4);
    expect(related(r).length).toBeGreaterThan(3);
  });
});
