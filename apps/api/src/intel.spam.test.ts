import { describe, expect, it } from "vitest";
import { isSpamLegs } from "./intel.js";

describe("wallet_history spam labelling", () => {
  it("flags URL-bait airdrop tokens", () => {
    expect(isSpamLegs([{ symbol: "www.fabax.cfd ✅", usd: null }])).toBe(true);
    expect(isSpamLegs([{ symbol: "Visit uni-claim.org to claim", usd: 0 }])).toBe(true);
  });
  it("does not flag priced real tokens", () => {
    expect(isSpamLegs([{ symbol: "USDC", usd: 100 }])).toBe(false);
  });
});
