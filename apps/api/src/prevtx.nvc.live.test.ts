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

  // The production failure case: 4QmXuz75... with 38 unspent coinstake (P2PK) outputs. The unspent list is derived
  // live from api.novaco.in/listtransactionsbyaddress (outputs to the address with no "spent" txid) and served as
  // cryptoid would; the 38 previous txs are fetched live (3-wide, 503/429 retried) and blocktools builds the sweep.
  it("builds the 38-input sweep for 4QmXuz75XYsGXR7rFvbWXHbW7T7Hp2LmYK", {
    timeout: 90_000,
  }, async () => {
    const A = "4QmXuz75XYsGXR7rFvbWXHbW7T7Hp2LmYK";
    const { resetPrevTxCache } = await import("./prevtx.js");
    const { resetCryptoid, utxoSweep } = await import("./utxochains.js");
    type Out = {
      address?: string;
      value: number;
      index?: number;
      spent?: string;
      scriptPubKey: { hex: string };
    };
    const list = (await (
      await fetch(`https://api.novaco.in/listtransactionsbyaddress/${A}`, {
        signal: AbortSignal.timeout(30000),
      })
    ).json()) as { txid: string; vout: Out[] | Record<string, Out> }[];
    const utxos = list.flatMap((t) =>
      Object.entries(t.vout)
        .filter(([, o]) => o.address === A && !o.spent)
        .map(([k, o]) => ({
          txid: t.txid,
          vout: Number(o.index ?? k),
          value: BigInt(o.value),
          script: o.scriptPubKey.hex.toLowerCase(),
        })),
    );
    const total = utxos.reduce((x, u) => x + u.value, 0n);
    const key = process.env.CRYPTOID_API_KEY;
    process.env.CRYPTOID_API_KEY = "live-test";
    resetCryptoid();
    resetPrevTxCache();
    const statuses: number[] = [];
    const f = (async (u: string | URL, init?: RequestInit) => {
      const s = String(u);
      if (s.startsWith("https://chainz.cryptoid.info/nvc/api.dws?q=unspent"))
        return new Response(
          JSON.stringify({
            unspent_outputs: utxos.map((x) => ({
              tx_hash: x.txid,
              tx_ouput_n: x.vout,
              value: String(x.value * 100n),
              ...(process.env.NVC_WITH_SCRIPT ? { script: x.script } : {}),
              confirmations: 100,
            })),
          }),
        );
      const r = await fetch(u, init);
      if (new URL(s).host === "api.novaco.in") statuses.push(r.status);
      return r;
    }) as typeof fetch;
    const t0 = Date.now();
    try {
      // All 38 are coinstake P2PK outputs of this address's key. Since blocktools 4f6445a the sweep adopts P2PK from
      // each fetched prev_tx (hash160(key) must equal the address), so the build succeeds with or without scripts.
      let s: any = null;
      let err = "";
      try {
        s = await utxoSweep(f, "nvc", A, A);
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      console.log(
        JSON.stringify({
          utxos: utxos.length,
          total: String(total),
          amount: s?.amount,
          fee: s?.fee,
          err,
          ms: Date.now() - t0,
          requests: statuses.length,
          non200: statuses.filter((x) => x !== 200),
        }),
      );
      expect(err).not.toMatch(/could not fetch the previous transactions/);
      expect(err).toBe("");
      expect(BigInt(s.amount) + BigInt(s.fee)).toBe(total);
    } finally {
      if (key === undefined) delete process.env.CRYPTOID_API_KEY;
      else process.env.CRYPTOID_API_KEY = key;
    }
  });
});
