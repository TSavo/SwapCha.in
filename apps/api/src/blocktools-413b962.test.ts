import { CHAIN_TABLE as CHAINS } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { btAddrValid, btDetectChains, btSweep } from "./blocktools.js";
import { coinsOf } from "./utxochains.js";

// blocktools 413b962: PIVX, Syscoin, Firo are address/WIF rows only (no signing, no sweep build).
// Vectors: Trust Wallet Core tests/chains/{Pivx,Syscoin,Firo} (public).
const TWC = {
  pivx: ["D6E4vLacYhKc6RVxLNQg5j8rtWbAH8fybH", "DSHhD6WxT5RfG2deUzVfuC1jDuRfdDpsSo"],
  sys: ["SXBPFk2PFDAP13qyKSdC4yptsJ8kJRAT3T", "sys1qcgnevr9rp7aazy62m4gen0tfzlssa52a2z04vc"],
  firo: ["aAbqxogrjdy2YHVcnQxFHMzqpt2fhjCTVT", "4CFa4fnAQvFz4VpikGNzQ9XfCDXMmdk6sh"],
};
const D = "DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE";

describe("blocktools 413b962 address-only chains", () => {
  it("validates Trust Wallet Core vectors and rejects a bad checksum", () => {
    for (const [c, as] of Object.entries(TWC))
      for (const a of as) {
        expect(btAddrValid(c, a)).toBe(true);
        expect(btAddrValid(c, `${a.slice(0, -1)}${a.endsWith("2") ? "3" : "2"}`)).toBe(false);
      }
  });
  it("D-prefixed base58 has three candidates: doge, dgb, pivx", () => {
    expect(btDetectChains(D)).toEqual(["doge", "dgb", "pivx"]);
  });
  it("money scan only uses coins SwapChan can scan/sweep (no pivx/sys/firo)", () => {
    expect(coinsOf(D)).toEqual(["doge", "dgb"]);
    for (const a of [...TWC.pivx, ...TWC.sys, ...TWC.firo])
      for (const c of coinsOf(a)) expect(["pivx", "sys", "firo"]).not.toContain(c);
  });
  it("registry marks them address-only and blocktools refuses a sweep", () => {
    for (const n of ["pivx", "sys", "firo"]) {
      const r = CHAINS.find((c) => c.name === n);
      expect(r).toMatchObject({ buildable: false, sign: "none", encoding: "utxo" });
    }
    const u = [{ txid: "11".repeat(32), vout: 0, amount: "100000", address: TWC.pivx[0]! }];
    expect(() => btSweep("pivx", u, TWC.pivx[1]!, 1)).toThrow();
  });
});
