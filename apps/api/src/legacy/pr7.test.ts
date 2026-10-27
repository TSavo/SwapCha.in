import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import { registryCollisions, verifyClaimTx } from "../intel.js";
import { labels, REGISTRY, REGISTRY_ALLOWLIST, scanned } from "./registry.js";
import { SIM_SPECS, scanSimClaim, simClaimData, simLabel, validSimClaim } from "./simclaim.js";

const pr7 = () => scanned().filter((e) => e.confirmedAtBlock === 26281424);
const CLAIMS: Record<string, string> = {
  personabid: "claimAndRefund()",
  ambassadors_fund: "release(address)",
};
const OWNER = "0x00000000000000000000000000000000000000aa";

describe("LegacyETH PR 7", () => {
  it("2 sim-claim rows confirmed at block 26281424; counts", () => {
    expect(
      pr7()
        .map((e) => e.key)
        .sort(),
    ).toEqual(Object.keys(CLAIMS).sort());
    expect(pr7().every((e) => e.family === "sim-claim")).toBe(true);
    expect(pr7().some((e) => e.multiStep)).toBe(false);
    expect(scanned().length).toBe(178);
    expect(REGISTRY.filter((e) => e.status === "not-checked").length).toBe(112);
    expect(registryCollisions()).toEqual([]);
  });
  it("each row is pinned in code: address, exact claim selector, value-0 allowlist", () => {
    for (const e of pr7()) {
      const s = SIM_SPECS[e.key]!;
      expect(e.claim).toBe(CLAIMS[e.key]);
      expect(s.claim).toBe(CLAIMS[e.key]);
      expect(s.address).toBe(e.address.toLowerCase());
      expect(REGISTRY_ALLOWLIST[s.address]).toEqual([btSelector(s.claim)]);
      expect(validSimClaim({ ...e, claim: "withdraw()" })).toBe(false);
    }
  });
  it("caller-argument claim: calldata is exactly selector + the owner's own address", () => {
    const s = SIM_SPECS.ambassadors_fund!;
    expect(s.arg).toBe("caller");
    const d = simClaimData(s, OWNER);
    expect(d).toBe(`${btSelector("release(address)")}${"0".repeat(62)}aa`);
    expect(d.length).toBe(10 + 64);
    expect(() => simClaimData(s, "0x1234")).toThrow();
    expect(simClaimData(SIM_SPECS.personabid!, OWNER)).toBe(btSelector("claimAndRefund()"));
    expect(verifyClaimTx({ to: s.address, data: d, value: "0" }, undefined, OWNER).verified).toBe(
      true,
    );
    expect(verifyClaimTx({ to: s.address, data: d, value: "1" }, undefined, OWNER).verified).toBe(
      false,
    );
  });
  it("scan simulates and builds the claim with the owner's address", async () => {
    const e = REGISTRY.find((x) => x.key === "ambassadors_fund")!;
    const c = e.address.toLowerCase();
    const word = (a: string) => `0x${a.replace(/^0x/, "").padStart(64, "0")}`;
    const sent: unknown[] = [];
    const client = {
      getBalance: async () => 10n ** 19n,
      request: async (a: never) => {
        sent.push(a);
        return [
          {
            calls: [
              {
                status: "0x1",
                logs: [
                  {
                    address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                    topics: [
                      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                      word(c),
                      word(OWNER),
                    ],
                    data: "0x2096a8eef5cfa000",
                  },
                ],
              },
            ],
          },
        ];
      },
    };
    const r = await scanSimClaim(client, OWNER, 26281424n, [e]);
    expect(r.failed).toEqual([]);
    expect(r.hits[0]!.owedWei).toBe(2348250000000000000n);
    expect(r.hits[0]!.tx!.data).toBe(simClaimData(SIM_SPECS.ambassadors_fund!, OWNER));
    expect(JSON.stringify(sent)).toContain(`${"0".repeat(62)}aa`);
  });
  it("labels say what the claim does, neutral wording", () => {
    const g = (k: string) => simLabel(REGISTRY.find((e) => e.key === k)!)!;
    expect(g("ambassadors_fund")).toMatch(
      /^Payment split: release\(address\) called with your own address/,
    );
    expect(g("personabid")).toMatch(/^Refund: claimAndRefund\(\)/);
    for (const e of pr7())
      expect(labels(e, 1n, 1n).join(" ")).not.toMatch(/fee|free|pric|two steps/i);
  });
});
