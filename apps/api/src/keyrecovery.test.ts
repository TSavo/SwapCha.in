import { describe, expect, it } from "vitest";
import { KEY_WARNINGS, RECOVERY_BRANCHES, recoveryGuide } from "./keyrecovery.js";

describe("recovery_guide", () => {
  it("full playbook includes every branch, warnings and derivation paths", () => {
    const g = recoveryGuide("full");
    expect(g.warnings).toEqual(KEY_WARNINGS);
    expect(g.situations).toHaveLength(RECOVERY_BRANCHES.length);
    expect(g.derivationPaths!.length).toBeGreaterThan(5);
    expect(g.blocktools?.url).toBe("https://github.com/TSavo/blocktools");
  });
  it("DIY crypto snippets are replaced by real blocktools commands", () => {
    const code = (id: string) => RECOVERY_BRANCHES.find((b) => b.id === id)!.code ?? "";
    expect(code("seed-phrase")).toContain(
      "seed-to-master --passphrase-file passphrases.txt < seed.txt | derive --preset scan-js --address-list > addresses.txt",
    );
    expect(code("missing-word")).toContain(
      "seed-repair < seed.txt | seed-to-master | derive --preset scan-js --match targets.txt --address-list",
    );
    expect(code("passphrase")).toContain("--passphrase-file passphrases.txt");
    expect(code("keystore")).toContain("keystore-open | redact");
    expect(code("raw-key")).toContain("key-to-addresses < key.txt | redact");
    for (const b of RECOVERY_BRANCHES) {
      const c = b.code ?? "";
      // no hand-written key derivation left in SwapChan
      expect(c).not.toMatch(
        /@scure|from viem|bip_utils|mnemonicToSeed|HDKey|eth_account|Account\.decrypt/,
      );
      expect(c).not.toMatch(/scan\.mjs/);
    }
    // presale is not supported by blocktools: its guide stays on pyethsaletool / btcrecover
    expect(RECOVERY_BRANCHES.find((b) => b.id === "presale")!.tools).toContain("pyethsaletool");
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
