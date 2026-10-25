/** Test fixtures: synthetic previous transactions (public data) so legacy sweep inputs pass blocktools' prev_tx proof. */
import { txidOfRaw } from "../prevtx.js";
import { type Coin, outputScript } from "../utxochains.js";

// nTime after the version (RDD v1 has no nTime; v2 puts it after the locktime)
const POS = new Set(["ppc", "nvc", "clam"]);
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const vi = (n: number) =>
  n < 0xfd
    ? Buffer.from([n])
    : Buffer.concat([Buffer.from([0xfd]), Buffer.from([n & 255, n >> 8])]);

/** Previous tx (version 1; pos-ntime chains carry nTime after the version) whose output `vout` pays `value` to `addr`. */
export function fakePrev(coin: Coin, addr: string, value: string | bigint, vout = 0, seed = 0) {
  const spk = outputScript(addr, coin);
  const outs: Buffer[] = [];
  for (let i = 0; i <= vout; i++) outs.push(u64(BigInt(value)), vi(spk.length), spk);
  const hex = Buffer.concat([
    u32(1),
    ...(POS.has(coin) ? [u32(1_700_000_000)] : []),
    vi(1),
    Buffer.alloc(32, seed & 255),
    u32(seed >>> 8),
    vi(2),
    Buffer.from([1, seed & 255]),
    u32(0xffffffff),
    vi(vout + 1),
    ...outs,
    u32(0),
  ]).toString("hex");
  return { txid: txidOfRaw(hex, coin === "grs"), hex };
}

/** UTXOs with real txids plus the raw prev txs keyed by txid. */
export function prevUtxos(
  coin: Coin,
  addr: string,
  values: (string | bigint)[],
  vout = 0,
  seed0 = 1,
) {
  const prev = new Map<string, string>();
  const utxos = values.map((v, n) => {
    const p = fakePrev(coin, addr, v, vout, seed0 + n);
    prev.set(p.txid, p.hex);
    return { txid: p.txid, vout, value: String(v) };
  });
  return { utxos, prev };
}

/** Wrap a mock fetch: serve raw previous txs on the blockbook / insight / qtum.info / WhatsOnChain raw-tx paths. */
export function withPrev(prev: Map<string, string>, inner: (u: string) => unknown): typeof fetch {
  return (async (u: string) => {
    const m =
      /\/api\/v2\/tx\/([0-9a-f]{64})/.exec(u) ??
      /\/rawtx\/([0-9a-f]{64})/.exec(u) ??
      /\/raw-tx\/([0-9a-f]{64})/.exec(u) ??
      /\/tx\/([0-9a-f]{64})\/hex/.exec(u);
    if (m) {
      const h = prev.get(m[1]!);
      if (!h) return new Response("not found", { status: 404 });
      if (u.includes("/api/v2/tx/")) return new Response(JSON.stringify({ txid: m[1], hex: h }));
      if (u.includes("/rawtx/")) return new Response(JSON.stringify({ rawtx: h }));
      return new Response(h);
    }
    return inner(u);
  }) as unknown as typeof fetch;
}
