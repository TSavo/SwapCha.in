import { describe, expect, it } from "vitest";

// Live, build-only (no signing, nothing broadcast): LIVE_BLK=1 npx vitest run src/prevtx.blk.live.test.ts
// The UTXO list (normally cryptoid, keyed) is taken from a fresh mainnet tx's P2PKH outputs; the previous txs are
// fetched live from blackcoin.nl / projectblackcoin.org and hash-checked, and blocktools builds the unsigned sweep.
const live = process.env.LIVE_BLK === "1";
const j = async (u: string) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  return r.json() as Promise<any>;
};
describe.skipIf(!live)("BLK live unsigned sweep build", () => {
  it("builds from live prev txs", { timeout: 60_000 }, async () => {
    // imported lazily so the skipped (default) run stays cheap
    const { resetPrevTxCache } = await import("./prevtx.js");
    const { COINS, outputScript, resetCryptoid, utxoSweep } = await import("./utxochains.js");
    const last = await j("https://mainnet.blackcoin.nl/ext/getlasttxs/1/0/20");
    let pick: { a: string; utxos: { txid: string; vout: number; value: string }[] } | null = null;
    for (const t of last) {
      const d = (await j(`https://projectblackcoin.org/api/explorer/tx/${t.txid}`)).data;
      const o = (d.outputs as any[]).find(
        (x) => /^B/.test(x.address ?? "") && BigInt(x.value_sats) > 10n ** 8n,
      );
      if (o) {
        pick = { a: o.address, utxos: [{ txid: t.txid, vout: o.index, value: o.value_sats }] };
        break;
      }
    }
    expect(pick).not.toBeNull();
    const { a, utxos } = pick!;
    const prevSweep = COINS.blk.sweep;
    (COINS.blk as { sweep: boolean }).sweep = true;
    const key = process.env.CRYPTOID_API_KEY;
    process.env.CRYPTOID_API_KEY = "live-test";
    resetCryptoid();
    resetPrevTxCache();
    const hits: string[] = [];
    const f = (async (u: string | URL, init?: RequestInit) => {
      const s = String(u);
      if (s.startsWith("https://chainz.cryptoid.info/blk/api.dws?q=unspent"))
        return new Response(
          JSON.stringify({
            unspent_outputs: utxos.map((x) => ({
              tx_hash: x.txid,
              tx_ouput_n: x.vout,
              value: x.value,
              script: outputScript(a, "blk").toString("hex"),
              confirmations: 3,
            })),
          }),
        );
      hits.push(new URL(s).host);
      return fetch(u, init);
    }) as typeof fetch;
    try {
      const s = (await utxoSweep(f, "blk", a, a)) as any;
      console.log(
        JSON.stringify({
          a,
          inputs: utxos.length,
          amount: s.amount,
          fee: s.fee,
          hosts: [...new Set(hits)],
          keys: Object.keys(s),
        }),
      );
      expect(BigInt(s.amount) + BigInt(s.fee)).toBe(BigInt(utxos[0]!.value));
      expect(hits.some((h) => h === "mainnet.blackcoin.nl" || h === "projectblackcoin.org")).toBe(
        true,
      );
    } finally {
      (COINS.blk as { sweep: boolean }).sweep = prevSweep;
      if (key === undefined) delete process.env.CRYPTOID_API_KEY;
      else process.env.CRYPTOID_API_KEY = key;
    }
  });
});
