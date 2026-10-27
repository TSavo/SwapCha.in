import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import { simClaimAllowlisted, verifyClaimTx } from "../intel.js";
import { describeTxCall, recoveryInfo } from "../recover.js";
import { FAMILY_CLAIM, scanned } from "./registry.js";
import { SIM_SPECS, simClaimData } from "./simclaim.js";

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const AF = SIM_SPECS.ambassadors_fund!;
const PB = SIM_SPECS.personabid!;
const REL = btSelector("release(address)");
const tx = (to: string, data: string, value = "0") => ({ chainId: 1, to, data, value });

describe("caller-argument claims: exact calldata only", () => {
  it("accepts selector + the owner's own address", () => {
    const d = simClaimData(AF, OWNER);
    expect(verifyClaimTx({ to: AF.address, data: d, value: "0" }, undefined, OWNER).verified).toBe(
      true,
    );
    expect(
      verifyClaimTx(
        { to: AF.address, data: d.toUpperCase().replace("0X", "0x"), value: "0" },
        undefined,
        OWNER,
      ).verified,
    ).toBe(true);
  });
  it("rejects release(otherAddress), and any call with no known sender", () => {
    const d = simClaimData(AF, OTHER);
    expect(verifyClaimTx({ to: AF.address, data: d, value: "0" }, undefined, OWNER).verified).toBe(
      false,
    );
    expect(
      verifyClaimTx({ to: AF.address, data: simClaimData(AF, OWNER), value: "0" }).verified,
    ).toBe(false);
    expect(
      verifyClaimTx({ to: AF.address, data: REL, value: "0" }, undefined, OWNER).verified,
    ).toBe(false);
  });
  it("rejects padding variations and trailing bytes", () => {
    const a = OWNER.slice(2);
    for (const d of [
      `${REL}${a}`,
      `${REL}${a.padStart(62, "0")}`,
      `${REL}${a.padStart(66, "0")}`,
      `${REL}${a.padEnd(64, "0")}`,
      `${REL}${"f".repeat(24)}${a}`,
      `${simClaimData(AF, OWNER)}00`,
      `${simClaimData(AF, OWNER)}${"00".repeat(32)}`,
    ])
      expect(
        verifyClaimTx({ to: AF.address, data: d, value: "0" }, undefined, OWNER).verified,
      ).toBe(false);
    expect(
      verifyClaimTx({ to: AF.address, data: simClaimData(AF, OWNER), value: "1" }, undefined, OWNER)
        .verified,
    ).toBe(false);
  });
  it("other claims unchanged (owner optional)", () => {
    const pb = btSelector(PB.claim);
    expect(verifyClaimTx({ to: PB.address, data: pb, value: "0" }).verified).toBe(true);
    expect(verifyClaimTx({ to: PB.address, data: pb, value: "0" }, undefined, OTHER).verified).toBe(
      true,
    );
    expect(verifyClaimTx({ to: PB.address, data: pb, value: "1" }).verified).toBe(false);
    const hong = SIM_SPECS.hong!;
    expect(
      verifyClaimTx({ to: hong.address, data: btSelector(hong.claim), value: "0" }).verified,
    ).toBe(true);
  });
  it("/simulate allowlist check uses the sender", async () => {
    const client = { readContract: async () => 0n };
    const d = simClaimData(AF, OWNER);
    expect(await simClaimAllowlisted(client, 1, OWNER, AF.address, { data: d })).toBe(true);
    expect(await simClaimAllowlisted(client, 1, OTHER, AF.address, { data: d })).toBe(false);
  });
});

describe("registry claim calls are named, not 'unknown function'", () => {
  it("PersonaBid claimAndRefund() and Ambassadors Fund release(address account)", () => {
    const p = describeTxCall(tx(PB.address, btSelector(PB.claim)));
    expect(p.signature).toBe("claimAndRefund()");
    expect(p.function).toBe("claimAndRefund");
    const r = describeTxCall(tx(AF.address, simClaimData(AF, OWNER)));
    expect(r.signature).toBe("release(address)");
    expect(r.args).toEqual([
      { name: "account", type: "address", value: expect.stringMatching(/^0x0+aa$/i) },
    ]);
    expect(r.plain).not.toContain("unknown function");
  });
  it("every sim-claim and registry family claim decodes", () => {
    for (const s of Object.values(SIM_SPECS))
      expect(describeTxCall(tx(s.address, simClaimData(s, OWNER))).signature).toBe(s.claim);
    for (const sig of [
      ...Object.values(FAMILY_CLAIM),
      ...scanned()
        .map((e) => e.claim!)
        .filter(Boolean),
    ])
      expect(
        describeTxCall(tx(OTHER, btSelector(sig) + "00".repeat(32 * 8))).function,
      ).not.toBeNull();
  });
  it("recovery package: verified via the claim allowlist, only for the owner's own calldata", () => {
    const it_ = (data: string) => ({
      claimTx: { ...tx(AF.address, data), description: "x" },
      swapUrl: "u",
    });
    const ok = recoveryInfo(OWNER, it_(simClaimData(AF, OWNER)))!;
    expect(ok.recoveryTx.verified).toBe(true);
    expect(ok.recoveryTx.verifiedBy).toBe("claim-allowlist");
    expect(ok.call.signature).toBe("release(address)");
    expect(recoveryInfo(OWNER, it_(simClaimData(AF, OTHER)))!.recoveryTx.verified).toBe(false);
    const pb = recoveryInfo(OWNER, {
      claimTx: { ...tx(PB.address, btSelector(PB.claim)), description: "x" },
      swapUrl: "u",
    })!;
    expect(pb.recoveryTx.verified).toBe(true);
    expect(pb.call.signature).toBe("claimAndRefund()");
  });
});
