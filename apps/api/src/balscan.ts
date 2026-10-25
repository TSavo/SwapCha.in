import { evmClient } from "./onchain.js";

/** Cheap "same 1-arg view call on many contracts" via Multicall3.aggregate3, hand-encoded.
 *  viem's multicall() ABI-encodes/decodes every contract object generically: for the ~10k-target
 *  vault/gauge sweeps that was the dominant CPU + heap cost per find_money (GC 22%, body encode 30%).
 *  Here calldata is built by string concat (identical callData per target) and results parsed by offset.
 *  Goes through the scoped global fetch, so it aborts with the scan deadline. */
const MC3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
export const SEL = { balanceOf: "70a08231", earned: "008cc262" } as const;
const w = (n: number) => n.toString(16).padStart(64, "0");

export function encodeAgg3(targets: readonly string[], sel: string, arg: string): `0x${string}` {
  const n = targets.length;
  const a = arg.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  // tuple = target, allowFailure=1, offset(0x60), len(0x24), sel+arg padded to 64 bytes => 6 words
  const tail = w(1) + w(0x60) + w(0x24) + sel + a + "0".repeat(56);
  const parts: string[] = ["0x82ad56cb", w(0x20), w(n)];
  for (let i = 0; i < n; i++) parts.push(w(n * 32 + i * 192));
  for (const t of targets) parts.push(t.toLowerCase().replace(/^0x/, "").padStart(64, "0") + tail);
  return parts.join("") as `0x${string}`;
}

/** Decode aggregate3 result -> uint256 per call (null on failure / short return). */
export function decodeAgg3Uint(hex: string, n: number): (bigint | null)[] {
  const h = hex.replace(/^0x/, "");
  const word = (byteOff: number) => parseInt(h.slice(byteOff * 2, byteOff * 2 + 64).slice(-12), 16);
  const base = word(0); // offset to array
  const len = word(base);
  const out: (bigint | null)[] = new Array(n).fill(null);
  const head = base + 32;
  for (let i = 0; i < Math.min(len, n); i++) {
    const t = head + word(head + i * 32);
    const ok = word(t) === 1;
    const rd = t + word(t + 32);
    const rl = word(rd);
    if (ok && rl >= 32) out[i] = BigInt("0x" + h.slice((rd + 32) * 2, (rd + 64) * 2));
  }
  return out;
}

export async function callMany(
  chainId: number,
  env: NodeJS.ProcessEnv,
  targets: readonly string[],
  sel: string,
  arg: string,
  chunk = 800,
  par = 2,
): Promise<(bigint | null)[]> {
  const c = evmClient(chainId, env);
  const out: (bigint | null)[] = new Array(targets.length).fill(null);
  const idx: number[] = [];
  for (let i = 0; i < targets.length; i += chunk) idx.push(i);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(par, idx.length) }, async () => {
      while (next < idx.length) {
        const s = idx[next++]!;
        const ts = targets.slice(s, s + chunk);
        try {
          const r = await c.call({ to: MC3, data: encodeAgg3(ts, sel, arg) });
          decodeAgg3Uint(r.data ?? "0x", ts.length).forEach((v, j) => (out[s + j] = v));
        } catch {
          /* chunk failed: leave nulls */
        }
      }
    }),
  );
  return out;
}
