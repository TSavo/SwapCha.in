import { CHAIN_TABLE as CHAINS } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { btAddrValid, btDetectChains } from "./blocktools.js";

// blocktools 7ca91c5 / 515311f / 9e2fb0c / ff5b7f5 (vendored at 1f1fa71): 33 address-only rows (no signing here).
// Cosmos examples: the atom example's 20-byte hash re-encoded per prefix; Ethermint: the eth example's 20 bytes;
// ed25519: Trust Wallet Core CoinAddressDerivationTests addresses for its public dummy key.
const COSMOS: Record<string, string> = {
  strd: "stride1hsk6jryyqjfhp5dhc55tc9jtckygx0ep53d3mx",
  tia: "celestia1hsk6jryyqjfhp5dhc55tc9jtckygx0epxsua48",
  cro: "cro1hsk6jryyqjfhp5dhc55tc9jtckygx0ep0p95nm",
  rune: "thor1hsk6jryyqjfhp5dhc55tc9jtckygx0ep3a5k64",
  coreum: "core1hsk6jryyqjfhp5dhc55tc9jtckygx0epy54kg3",
  inj: "inj1mrdxhunfvjhe6lkancp72dq46da2jcz9lmv4wx",
  zeta: "zeta1mrdxhunfvjhe6lkancp72dq46da2jcz9rk4yxw",
};
const ED: Record<string, string> = {
  aptos: "0xce2fd04ac9efa74f17595e5785e847a2399d7e637f5e8179244f76191f653276",
  sui: "0x870deb25d5c0a4d7250d52d5cd58dacca2d51eb2a120a979b13384cd52e21e1b",
  near: "ee93a4f66f8d16b819bb9beb9ffccdfcdc1412e87fee6a324c2a99a1e0e67148",
  xtz: "tz1gcEWswVU6dxfNQWbhTgaZrUrNUFwrsT4z",
  egld: "erd1a6f6fan035ttsxdmn04ellxdlnwpgyhg0lhx5vjv92v6rc8xw9yq83344f",
};
const NEW = [
  ..."strd axl cre kuji cmdx ntrn somm fet mars umee noble sei tia coreum qsr xprt akt kava blz band cro bld dydx rune".split(
    " ",
  ),
  ..."inj evmos canto zeta aptos sui near xtz egld".split(" "),
];

describe("blocktools 1f1fa71 address rows", () => {
  it("bech32 rows validate only on their own prefix, are detected as that chain, reject a bad checksum", () => {
    for (const [c, a] of Object.entries(COSMOS)) {
      for (const o of Object.keys(COSMOS)) expect(btAddrValid(o, a)).toBe(o === c);
      expect(btDetectChains(a)).toEqual([c]);
      expect(btAddrValid(c, `${a.slice(0, -1)}${a.endsWith("q") ? "p" : "q"}`)).toBe(false);
    }
    expect(btAddrValid("atom", COSMOS.strd as string)).toBe(false);
  });
  it("ed25519 rows validate and are detected (aptos/sui/near hex shapes overlap, so detect may list several)", () => {
    for (const [c, a] of Object.entries(ED)) {
      expect(btAddrValid(c, a)).toBe(true);
      expect(btDetectChains(a)).toContain(c);
    }
    expect(btDetectChains(ED.xtz as string)).toEqual(["xtz"]);
    expect(btDetectChains(ED.egld as string)).toEqual(["egld"]);
    expect(btAddrValid("near", "alice.near")).toBe(false);
    expect(btAddrValid("xtz", "tz1gcEWswVU6dxfNQWbhTgaZrUrNUFwrsT4A")).toBe(false);
  });
  it("registry marks all 33 address-only (not buildable)", () => {
    for (const n of NEW)
      expect(CHAINS.find((c) => c.name === n)).toMatchObject({ buildable: false });
  });
});
