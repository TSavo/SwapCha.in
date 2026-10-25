import { describe, expect, it } from "vitest";
import { scriptCorpus } from "./addr.corpus.js";
import gold from "./fixtures/output-script-golden.json" with { type: "json" };
import { COINS, outputScript } from "./utxochains.js";

/**
 * outputScript (blocktools wasm addressToScript) vs the deleted TS base58check/bech32 decoder: 2928 addresses over
 * all 29 coins (p2pkh/p2sh/bech32 v0 lower + UPPER, bad checksum, wrong version/HRP, truncated, v1). Golden = TS
 * output, except mixed-case bech32 (138), an intentional refuse under BIP-173 (the TS lowercased first).
 */
describe("outputScript parity (blocktools wasm)", () => {
  it("matches the frozen TS golden; mixed-case bech32 refused", () => {
    const cs = scriptCorpus(Object.entries(COINS) as never);
    const g = gold as [string, string, string][];
    expect(cs.length).toBe(2928);
    expect(cs.map(([k, a]) => `${k} ${a}`)).toEqual(g.map(([k, a]) => `${k} ${a}`));
    let ok = 0;
    let refused = 0;
    for (const [k, a, want] of g) {
      let got = "ERR";
      try {
        got = outputScript(a, k as never).toString("hex");
      } catch {}
      expect(got, `${k} ${a}`).toBe(want);
      if (want === "ERR") refused++;
      else ok++;
    }
    // TS accepted 1440; 138 of those were mixed-case bech32
    expect([ok, refused]).toEqual([1302, 1626]);
  }, 60_000);
  it("zec t1/t3 and all-uppercase bech32 still decode", () => {
    const z = (gold as [string, string, string][]).filter(([k, , w]) => k === "zec" && w !== "ERR");
    expect(z.length).toBeGreaterThan(0);
    const up = (gold as [string, string, string][]).filter(([, a, w]) => w !== "ERR" && /^[A-Z0-9]+1[A-Z0-9]+$/.test(a));
    expect(up.length).toBeGreaterThan(0);
    for (const [k, a, w] of [...z, ...up]) expect(outputScript(a, k as never).toString("hex")).toBe(w);
  });
});
