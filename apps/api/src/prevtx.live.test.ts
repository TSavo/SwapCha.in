import { describe, expect, it } from "vitest";
import { resetPrevTxCache } from "./prevtx.js";
import { utxoSweep } from "./utxochains.js";

// Live, build-only smoke (no signing, nothing broadcast): LIVE_PREVTX=1 npx vitest run src/prevtx.live.test.ts
// Picks a P2PKH address paid in a recent block, then builds an unsigned sweep that needs prev_tx for every input.
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
          if (u.length >= 1 && u.length <= 12) return { a, n: u.length };
        }
  }
  throw new Error("no small P2PKH address found");
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
});
