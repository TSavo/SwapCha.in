import { describe, expect, it } from "vitest";

// Live, build-only (no signing, nothing broadcast): LIVE_NVC=1 npx vitest run src/prevtx.nvc.live.test.ts
// The UTXO list (normally cryptoid, keyed) is taken from real mainnet txs' P2PKH outputs as reported live by
// api.novaco.in; the previous txs are fetched live from api.novaco.in/gettransaction/<txid>, serialized and
// hash-checked by blocktools, and blocktools builds the unsigned sweep.
const live = process.env.LIVE_NVC === "1";
// a mainnet tx with P2PKH outputs (block 892255; listed by api.novaco.in/listtransactionsbyaddress). Its outputs are
// already spent, which does not matter for an unsigned build-only check. (Coinstakes pay P2PK, which the sweep refuses.)
const TXIDS = ["63a1147e4de4655c7e0bb7aec4135819be261742b735abfcecc0ee17044c5bf2"];
describe.skipIf(!live)("NVC live unsigned sweep build", () => {
  it("builds from live prev txs", { timeout: 60_000 }, async () => {
    const { resetPrevTxCache } = await import("./prevtx.js");
    const { COINS, outputScript, resetCryptoid, utxoSweep } = await import("./utxochains.js");
    let pick: { a: string; txid: string; vout: number; value: bigint } | null = null;
    for (const t of TXIDS) {
      const r = await fetch(`https://api.novaco.in/gettransaction/${t}`, {
        signal: AbortSignal.timeout(15000),
      });
      const d = (await r.json()) as {
        vout: { address?: string; index: number; value: number; scriptPubKey: { hex: string } }[];
      };
      const o = d.vout.find(
        (x) => x.scriptPubKey.hex.toLowerCase().startsWith("76a914") && x.value > 1_000_000,
      );
      if (o) {
        pick = { a: o.address!, txid: t, vout: o.index, value: BigInt(o.value) };
        break;
      }
    }
    expect(pick).not.toBeNull();
    const { a, txid, vout, value } = pick!;
    expect(COINS.nvc.sweep).toBe(true);
    const key = process.env.CRYPTOID_API_KEY;
    process.env.CRYPTOID_API_KEY = "live-test";
    resetCryptoid();
    resetPrevTxCache();
    const hits: string[] = [];
    const f = (async (u: string | URL, init?: RequestInit) => {
      const s = String(u);
      if (s.startsWith("https://chainz.cryptoid.info/nvc/api.dws?q=unspent"))
        return new Response(
          JSON.stringify({
            unspent_outputs: [
              {
                tx_hash: txid,
                tx_ouput_n: vout,
                value: String(value * 100n), // cryptoid reports 1e8 units; NVC has 6 decimals
                script: outputScript(a, "nvc").toString("hex"),
                confirmations: 3,
              },
            ],
          }),
        );
      hits.push(new URL(s).host);
      return fetch(u, init);
    }) as typeof fetch;
    try {
      const s = (await utxoSweep(f, "nvc", a, a)) as any;
      console.log(
        JSON.stringify({
          a,
          txid,
          amount: s.amount,
          fee: s.fee,
          by: s.builtBy,
          hosts: [...new Set(hits)],
        }),
      );
      expect(BigInt(s.amount) + BigInt(s.fee)).toBe(value);
      expect(hits).toContain("api.novaco.in");
    } finally {
      if (key === undefined) delete process.env.CRYPTOID_API_KEY;
      else process.env.CRYPTOID_API_KEY = key;
    }
  });
});
