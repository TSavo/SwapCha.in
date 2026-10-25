// Polkadot parity corpus. Golden digests in polkadot.parity.test.ts were recorded from SwapChan's former TS
// implementation (ledgers2.ts at 6fa60cd) before it was deleted in favour of blocktools 000a71a.
const le = (v: bigint, n: number) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return b.toString("hex");
};
const info = (n: number[], bal: bigint[]) =>
  `0x${n.map((x) => le(BigInt(x), 4)).join("")}${bal.map((x) => le(x, 16)).join("")}`;
export const ALICE = "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
const accts = [
  ALICE,
  "8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48",
  "00".repeat(32),
  "ff".repeat(32),
  "0123456789abcdef".repeat(4),
];
const PREFIXES = [0, 2, 5, 7, 42, 63];

// SS58 strings fixed (encoded once with blocktools ss58Encode; Alice prefix 0/42 match the published addresses)
import ADDRS from "./polkadot.addrs.json" with { type: "json" };
export const CORPUS = {
  accts,
  PREFIXES,
  blake: () => {
    const out: [string, number][] = [];
    for (let len = 0; len <= 300; len++) {
      const d = Buffer.from(Uint8Array.from({ length: len }, (_, i) => (i * 31 + len) & 0xff));
      for (const o of [16, 32, 64]) out.push([d.toString("hex"), o]);
    }
    return out;
  },
  addrs: () => ADDRS as string[],
  infos: [
    info([0, 0, 1, 0], [0n, 0n, 0n, 1n << 127n]),
    info([7, 1, 1, 0], [214_600_000_000_000_000n, 1n, 2n, 0n]),
    info([4294967295, 3, 2, 1], [(1n << 128n) - 1n, 12345678901234567890n, 10_000_000_000n, 0n]),
  ],
};
