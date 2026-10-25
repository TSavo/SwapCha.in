import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blocktools, btDecodeAccountInfo, btDotStorageKey, btSs58Decode } from "./blocktools.js";
import { decodeAccountInfo } from "./ledgers2.js";
import { ALICE, CORPUS } from "./polkadot.corpus.js";

// Parity: blocktools 000a71a WASM vs SwapChan's former hand-rolled TS (ledgers2.ts at 6fa60cd, now deleted).
// Each digest is sha256 over the old TS outputs for the whole corpus (recorded before deletion; also checked
// live TS-vs-wasm in 6fa60cd: 903 blake2b + 30 SS58 + 5 storage keys + 3 AccountInfo, all identical).
const GOLDEN = {
  blake2b: "58543f134eef793b557c813b2fd182362a75385cbd6af6049a8bd97a645b026f",
  ss58: "d608752bc9757a53f3f83bfe33ef6a47c2a66fba93cebdad9745dfbd99891b80",
  storageKey: "200799907fb226d59a2236fc559c931a1c1697110994a094447d7da8abc6a604",
  accountInfo: "5c37b2b957ff27b6150ad1be2960688a32f1de15e01d954c3148175d660b0e3e",
};
type W = { blake2b(d: string, n: number, p: string): string; twox128(t: string): string };
const w = () => blocktools() as unknown as W;
const h = (xs: string[]) => createHash("sha256").update(xs.join("\n")).digest("hex");

describe("polkadot parity: blocktools wasm vs former TS", () => {
  it("wasm loaded", () => expect(blocktools()).not.toBeNull());
  it("blake2b (903 cases)", () =>
    expect(h(CORPUS.blake().map(([d, o]) => w().blake2b(d, o, "")))).toBe(GOLDEN.blake2b));
  it("SS58 decode (5 accounts x 6 prefixes), known Alice addresses", () => {
    const addrs = CORPUS.addrs();
    expect(addrs[0]).toBe("15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5");
    expect(addrs[4]).toBe("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
    expect(btSs58Decode(addrs[4]!)).toEqual({ prefix: 42, account: ALICE });
    expect(h(addrs.map((a) => btSs58Decode(a).account.replace(/^0x/, "")))).toBe(GOLDEN.ss58);
  });
  it("bad checksum rejected", () => {
    const a = CORPUS.addrs()[0]!;
    expect(() => btSs58Decode(a.slice(0, -1) + (a.endsWith("5") ? "6" : "5"))).toThrow();
  });
  it("System.Account storage key; twox128 prefix", () => {
    expect(h(CORPUS.accts.map(btDotStorageKey))).toBe(GOLDEN.storageKey);
    expect(btDotStorageKey(CORPUS.addrs()[0]!)).toBe(btDotStorageKey(ALICE));
    expect(w().twox128("System") + w().twox128("Account")).toBe(
      "26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9",
    );
  });
  it("AccountInfo decode", () => {
    const rs = CORPUS.infos.map((x) => {
      const r = btDecodeAccountInfo(x);
      return `${r.free},${r.reserved},${r.frozen}`;
    });
    expect(h(rs)).toBe(GOLDEN.accountInfo);
    expect(decodeAccountInfo(null)).toEqual({ free: 0n, reserved: 0n, frozen: 0n });
  });
});
