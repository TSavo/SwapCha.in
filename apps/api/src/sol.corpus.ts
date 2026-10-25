import { createHash } from "node:crypto";

/** Deterministic Solana address-math corpus (sha256 chain from a fixed seed), shared by the parity tests. */
const h = (s: string) => new Uint8Array(createHash("sha256").update(s).digest());
const P = (1n << 255n) - 19n;
const le = (n: bigint, sign: number) => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    b[i] = Number(n & 255n);
    n >>= 8n;
  }
  b[31]! |= sign;
  return b;
};
/** Canonical-range keys only: the old TS rejected non-canonical y (>= p) and x=0-with-sign-bit, which
 *  blocktools (curve25519-dalek, like the Solana runtime) accepts; those 8 encodings are pinned separately. */
export const curveKeys = (): Uint8Array[] => {
  const out: Uint8Array[] = [];
  for (let i = 0; i < 3000; i++) out.push(h(`sol-curve-${i}`));
  for (const n of [0n, 1n, 2n, P - 1n]) out.push(le(n, 0));
  out.push(le(2n, 0x80));
  return out;
};
export const DALEK_ONLY = [1n, P - 1n]
  .map((n) => le(n, 0x80))
  .concat([P, P + 1n, (1n << 255n) - 1n].flatMap((n) => [le(n, 0), le(n, 0x80)]));
export const byteStrings = (): Uint8Array[] => {
  const out: Uint8Array[] = [];
  for (let i = 0; i < 2000; i++) {
    const x = h(`sol-b58-${i}`);
    const len = x[0]! % 70;
    const b = new Uint8Array(len);
    for (let j = 0; j < len; j++) b[j] = h(`sol-b58-${i}-${j}`)[0]!;
    for (let z = 0; z < Math.min(len, x[1]! % 4); z++) b[z] = 0;
    out.push(b);
  }
  return out;
};
export const pdaCases = (programs: string[]) =>
  Array.from({ length: 400 }, (_, i) => {
    const x = h(`sol-pda-${i}`);
    const seeds = Array.from({ length: x[0]! % 4 }, (_, k) =>
      h(`sol-pda-${i}-${k}`).slice(0, x[k + 1]! % 33),
    );
    return { seeds, program: programs[i % programs.length]! };
  });
export const MINTS = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSyqjtvhaz5kmuUEstC8DdgSrHGRWzQPj",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
];
export const ANCHOR_NAMES = [
  "claim",
  "order_unstake",
  "deposit",
  "liquid_unstake",
  "",
  "x".repeat(300),
];
