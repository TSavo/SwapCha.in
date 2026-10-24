import { describe, expect, it } from "vitest";
import { KEY_WARNINGS, RECOVERY_BRANCHES, recoveryGuide } from "./keyrecovery.js";

describe("recovery_guide", () => {
  it("full playbook includes every branch, warnings and derivation paths", () => {
    const g = recoveryGuide("full");
    expect(g.warnings).toEqual(KEY_WARNINGS);
    expect(g.situations).toHaveLength(RECOVERY_BRANCHES.length);
    expect(g.derivationPaths!.length).toBeGreaterThan(5);
    expect(g.situations.some((b: { code?: string }) => (b.code ?? "").includes("bip39"))).toBe(
      true,
    );
  });
  it("situation filters to one branch", () => {
    const g = recoveryGuide("presale");
    expect(g.situations).toHaveLength(1);
    expect(g.situations[0]!.id).toBe("presale");
    expect(g.situations[0]!.page).toMatch(/ethereum-presale/);
  });
  it("unknown situation returns known ids", () => {
    const g = recoveryGuide("nope");
    expect(g).toHaveProperty("error");
  });
});
