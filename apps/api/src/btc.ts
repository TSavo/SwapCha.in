import { btAddressToScript, btBuildPsbt } from "./blocktools.js";
import type { Fetch } from "./providers/types.js";

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
}
export type UtxoSource = (addr: string) => Promise<Utxo[]>;

/** Confirmed + unconfirmed UTXOs from mempool.space (keyless). */
export const mempoolUtxos =
  (f: Fetch = fetch, base = "https://mempool.space/api"): UtxoSource =>
  async (addr) => {
    const res = await f(`${base}/address/${addr}/utxo`);
    if (!res.ok) throw new Error(`utxo lookup ${res.status}`);
    return (await res.json()) as Utxo[];
  };

/**
 * Unsigned PSBT (base64) paying `amount` sats to `to`, an OP_RETURN memo, and change back to `from`
 * (THORChain order: vault, change, OP_RETURN), non-RBF. Only native SegWit (bc1q, P2WPKH) senders: witnessUtxo is
 * enough for any wallet to sign. Built by blocktools buildPsbtWithMemo (WASM); no TS fallback: if the WASM is
 * unavailable this throws.
 */
export async function buildBtcPsbt(
  utxos: UtxoSource,
  o: { from: string; to: string; amount: bigint; memo?: string; feeRate: number },
): Promise<string> {
  const spk = btAddressToScript("btc", o.from);
  if (!spk || !/^0014[0-9a-f]{40}$/.test(spk))
    throw new Error("Bitcoin sends need a native SegWit (bc1q…) address");
  const memo = o.memo ? Buffer.from(o.memo, "utf8") : null;
  if (memo && memo.length > 80) throw new Error("memo longer than 80 bytes");
  const all = await utxos(o.from);
  const rate = Math.max(1, Math.ceil(o.feeRate));
  try {
    return btBuildPsbt(
      "btc",
      all.map((u) => ({ txid: u.txid, vout: u.vout, amount: u.value, address: o.from })),
      o.to,
      o.amount,
      o.from,
      rate,
      memo ? memo.toString("hex") : "",
    ).psbt;
  } catch (e) {
    const m = (e as Error).message;
    if (/insufficient/.test(m)) throw new Error("Not enough BTC (including network fee)");
    throw new Error(`Bitcoin PSBT not built: ${m}`);
  }
}
