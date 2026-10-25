import { describe, expect, it } from "vitest";
import { resetPrevTxCache } from "./prevtx.js";
import { utxoSweep } from "./utxochains.js";

// Live, build-only smoke (no signing, nothing broadcast): LIVE_PREVTX=1 npx vitest run src/prevtx.live.test.ts
// Picks a P2PKH (and a bare P2SH) address paid in a recent block, then builds an unsigned sweep that needs prev_tx for every input.
const live = process.env.LIVE_PREVTX === "1";
const SRC = {
  doge: { bb: "https://blockbook.doge.zelcore.io", lead: /^D/ },
  ltc: { bb: "https://blockbook.ltc.zelcore.io", lead: /^L/ },
  bch: { bb: "https://bchblockexplorer.com", lead: /^(bitcoincash:)?q/ },
} as const;
const j = async (u: string) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  return r.json() as Promise<any>;
};
async function pick(base: string, lead: RegExp) {
  const best = (await j(`${base}/api/`)).blockbook.bestHeight as number;
  for (let h = best - 3; h > best - 40; h--) {
    const b = await j(`${base}/api/v2/block/${h}`);
    for (const tx of b.txs ?? [])
      for (const o of tx.vout ?? [])
        for (const a of o.addresses ?? []) {
          if (!lead.test(a) || !o.isAddress) continue;
          const u = await j(`${base}/api/v2/utxo/${a}`);
          // skip dust-only addresses: the sweep refuses UTXOs whose own fee is over 5% of their value
          const big = u.some((x: { value: string }) => BigInt(x.value) >= 10_000_000n);
          if (u.length >= 1 && u.length <= 12 && big) return { a, n: u.length };
        }
  }
  throw new Error(`no small address matching ${lead} found`);
}
describe.skipIf(!live)("live prev_tx sweep build (unsigned, no broadcast)", () => {
  for (const k of ["doge", "ltc", "bch"] as const)
    it(k, async () => {
      resetPrevTxCache();
      const { a, n } = await pick(SRC[k].bb, SRC[k].lead);
      const s = await utxoSweep(fetch, k, a, a);
      console.log(
        k,
        a,
        `utxos=${n} inputs=${s.inputs.length} fee=${s.fee} by=${s.builtBy} note=${s.note ?? ""}`,
      );
      expect(s.builtBy).toMatch(/^blocktools /);
      expect(s.inputs.length).toBeGreaterThan(0);
    }, 120_000);
  // bare P2SH (blocktools 2052b30): DOGE A/9..., LTC M...; prev_tx fetched for every input
  for (const [k, lead] of [
    ["doge", /^[A9]/],
    ["ltc", /^M/],
  ] as const)
    it(`${k} P2SH`, async () => {
      resetPrevTxCache();
      const { a, n } = await pick(SRC[k].bb, lead);
      const s = await utxoSweep(fetch, k, a, a);
      console.log(
        k,
        "p2sh",
        a,
        `utxos=${n} inputs=${s.inputs.length} fee=${s.fee} by=${s.builtBy} note=${s.note ?? ""}`,
      );
      expect(s.builtBy).toMatch(/^blocktools /);
      expect(s.inputs.length).toBeGreaterThan(0);
    }, 180_000);
});
