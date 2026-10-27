import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import { registryCollisions } from "../intel.js";
import { labels, REGISTRY, REGISTRY_ALLOWLIST, scanned } from "./registry.js";
import { SIM_SPECS, simLabel, validSimClaim } from "./simclaim.js";

const pr6 = () => scanned().filter((e) => e.confirmedAtBlock === 26281225);
const CLAIMS: Record<string, string> = {
  hourglassx: "withdraw()",
  singularx_fund: "withdrawReward()",
  qcotoken_ico: "requestRefund()",
  crowdsale_4363b5: "releaseEthers()",
  startmining_stm_sale: "manualRefund()",
  hodl_ethereum: "party()",
};

describe("LegacyETH PR 6", () => {
  it("6 sim-claim rows confirmed at block 26281225; counts", () => {
    expect(
      pr6()
        .map((e) => e.key)
        .sort(),
    ).toEqual(Object.keys(CLAIMS).sort());
    expect(pr6().every((e) => e.family === "sim-claim")).toBe(true);
    expect(scanned().length).toBe(176);
    expect(REGISTRY.filter((e) => e.status === "not-checked").length).toBe(114);
    expect(registryCollisions()).toEqual([]);
  });
  it("each row is pinned in code: address, exact claim selector, value-0 allowlist", () => {
    for (const e of pr6()) {
      const s = SIM_SPECS[e.key]!;
      expect(e.claim).toBe(CLAIMS[e.key]);
      expect(s.claim).toBe(CLAIMS[e.key]);
      expect(s.address).toBe(e.address.toLowerCase());
      expect(REGISTRY_ALLOWLIST[s.address]).toEqual([btSelector(s.claim)]);
      expect(validSimClaim({ ...e, claim: "exit()" })).toBe(false);
    }
  });
  it("new labels say what the claim does", () => {
    const g = (k: string) => simLabel(REGISTRY.find((e) => e.key === k)!)!;
    expect(g("singularx_fund")).toMatch(/^Rewards only: withdrawReward\(\)/);
    expect(g("hodl_ethereum")).toMatch(/^Time-lock release: party\(\)/);
    expect(g("hourglassx")).toMatch(/^Dividends only/);
    expect(g("qcotoken_ico")).toMatch(/^Refund: requestRefund\(\)/);
    for (const e of pr6()) expect(labels(e, 1n, 1n).join(" ")).not.toMatch(/fee|free|pric/i);
  });
});
