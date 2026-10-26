import { CHAIN_TABLE as CHAINS } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { btAddrValid, btDetectChains } from "./blocktools.js";

// blocktools c419553: Kusama and Polymesh SS58 rows on the Polkadot key (address only, no signing).
// Same 32-byte public key as the Polkadot /chains example, re-encoded with SS58 prefix 0 / 2 / 12.
const A = {
  dot: "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5",
  ksm: "DnZxLFY3cddikU5Thok5wbWRMskbCrSnh316FEhfQVHwKPb",
  polyx: "2DfAYFfZtXNuHLWiX2byrxFktDJh939eg6aKF5fiHxSAkFqy",
};

describe("blocktools c419553 Kusama/Polymesh", () => {
  it("each prefix validates only on its own chain and is detected as that chain", () => {
    for (const [c, a] of Object.entries(A)) {
      for (const o of Object.keys(A)) expect(btAddrValid(o, a)).toBe(o === c);
      expect(btDetectChains(a)).toContain(c);
      expect(btAddrValid(c, `${a.slice(0, -1)}${a.endsWith("2") ? "3" : "2"}`)).toBe(false);
    }
  });
  it("registry marks them address-only (not buildable)", () => {
    for (const n of ["ksm", "polyx"])
      expect(CHAINS.find((c) => c.name === n)).toMatchObject({
        buildable: false,
        encoding: "ss58",
      });
  });
});
