import { describe, expect, it } from "vitest";
import { blocktools } from "./blocktools.js";
import { blake2b, decodeAccountInfo, ss58PublicKey, systemAccountKey } from "./ledgers2.js";

// Parity: SwapChan's hand-rolled TS (ledgers2.ts) vs blocktools 000a71a WASM exports, before the TS is deleted.
type W = {
  blake2b(d: string, n: number, p: string): string;
  twox128(t: string): string;
  ss58Encode(a: string, p: number): string;
  ss58Decode(a: string): string;
  polkadotAccountStorageKey(a: string): string;
  decodeAccountInfo(h: string): string;
};
const w = () => blocktools() as unknown as W;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const ALICE = "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
const BOB = "8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";
const ACCTS = [ALICE, BOB, "00".repeat(32), "ff".repeat(32), "0123456789abcdef".repeat(4)];
const PREFIXES = [0, 2, 5, 7, 42, 63];
const le = (v: bigint, n: number) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return b.toString("hex");
};
const info = (n: number[], bal: bigint[]) =>
  `0x${n.map((x) => le(BigInt(x), 4)).join("")}${bal.map((x) => le(x, 16)).join("")}`;

describe("polkadot parity: ledgers2 TS vs blocktools wasm", () => {
  it("wasm loaded", () => expect(blocktools()).not.toBeNull());
  it("blake2b, every length 0..300 x outLen 16/32/64", () => {
    let n = 0;
    for (let len = 0; len <= 300; len++) {
      const d = Uint8Array.from({ length: len }, (_, i) => (i * 31 + len) & 0xff);
      for (const o of [16, 32, 64]) {
        expect(w().blake2b(hex(d), o, "")).toBe(hex(blake2b(d, o)));
        n++;
      }
    }
    expect(n).toBe(903);
  });
  it("twox128(System)++twox128(Account) is the TS constant", () => {
    const k = systemAccountKey(new Uint8Array(32)).slice(2, 66);
    expect(w().twox128("System") + w().twox128("Account")).toBe(k);
  });
  it("ss58: known Alice addresses and every account x prefix decode identically", () => {
    expect(w().ss58Encode(ALICE, 42)).toBe("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
    expect(w().ss58Encode(ALICE, 0)).toBe("15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5");
    for (const a of ACCTS)
      for (const p of PREFIXES) {
        const addr = w().ss58Encode(a, p);
        const j = JSON.parse(w().ss58Decode(addr)) as { prefix: number; account: string };
        expect(j.prefix).toBe(p);
        expect(j.account.replace(/^0x/, "")).toBe(hex(ss58PublicKey(addr)));
        expect(j.account.replace(/^0x/, "")).toBe(a);
      }
  });
  it("ss58: both reject a bad checksum", () => {
    const addr = w().ss58Encode(ALICE, 0);
    const bad = addr.slice(0, -1) + (addr.endsWith("5") ? "6" : "5");
    expect(() => ss58PublicKey(bad)).toThrow();
    expect(() => w().ss58Decode(bad)).toThrow();
  });
  it("System.Account storage key identical (SS58 and hex input)", () => {
    for (const a of ACCTS) {
      const ts = systemAccountKey(Buffer.from(a, "hex"));
      const norm = (s: string) => `0x${s.replace(/^0x/, "")}`;
      expect(norm(w().polkadotAccountStorageKey(a))).toBe(ts);
      expect(norm(w().polkadotAccountStorageKey(w().ss58Encode(a, 0)))).toBe(ts);
    }
  });
  it("AccountInfo decode identical (free/reserved/frozen)", () => {
    const cases = [
      info([0, 0, 1, 0], [0n, 0n, 0n, 1n << 127n]),
      info([7, 1, 1, 0], [214_600_000_000_000_000n, 1n, 2n, 0n]),
      info([4294967295, 3, 2, 1], [(1n << 128n) - 1n, 12345678901234567890n, 10_000_000_000n, 0n]),
    ];
    for (const h of cases) {
      const ts = decodeAccountInfo(h);
      const j = JSON.parse(w().decodeAccountInfo(h)) as {
        data: { free: string; reserved: string; frozen: string };
      };
      expect([j.data.free, j.data.reserved, j.data.frozen]).toEqual([
        ts.free.toString(),
        ts.reserved.toString(),
        ts.frozen.toString(),
      ]);
    }
  });
});
