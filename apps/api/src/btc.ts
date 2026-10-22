import { address, networks, Psbt, payments } from "bitcoinjs-lib";
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

const DUST = 546n;

/**
 * Unsigned PSBT (base64) paying `amount` sats to `to`, an OP_RETURN memo, and change back to
 * `from`. Only native SegWit (bc1q, P2WPKH) senders: witnessUtxo is enough for any wallet to sign.
 */
export async function buildBtcPsbt(
  utxos: UtxoSource,
  o: { from: string; to: string; amount: bigint; memo?: string; feeRate: number },
): Promise<string> {
  const net = networks.bitcoin;
  const script = address.toOutputScript(o.from, net);
  const p2wpkh = payments.p2wpkh({ output: script, network: net });
  if (!p2wpkh.address) throw new Error("Bitcoin sends need a native SegWit (bc1q…) address");
  const memo = o.memo ? Buffer.from(o.memo, "utf8") : null;
  if (memo && memo.length > 80) throw new Error("memo longer than 80 bytes");
  const all = (await utxos(o.from)).sort((a, b) => b.value - a.value);
  const rate = BigInt(Math.max(1, Math.ceil(o.feeRate)));
  const vbytes = (nIn: number) =>
    BigInt(Math.ceil(10.5 + 68 * nIn + 31 * 2 + (memo ? 11 + memo.length : 0)));
  const picked: Utxo[] = [];
  let total = 0n;
  for (const u of all) {
    picked.push(u);
    total += BigInt(u.value);
    if (total >= o.amount + vbytes(picked.length) * rate) break;
  }
  const fee = vbytes(picked.length) * rate;
  if (total < o.amount + fee) throw new Error("Not enough BTC (including network fee)");
  const psbt = new Psbt({ network: net });
  for (const u of picked)
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: Uint8Array.from(script), value: BigInt(u.value) },
    });
  psbt.addOutput({ address: o.to, value: o.amount });
  // THORChain wants: vault output, then change, then OP_RETURN.
  const change = total - o.amount - fee;
  if (change >= DUST) psbt.addOutput({ address: o.from, value: change });
  if (memo) {
    const op = payments.embed({ data: [Uint8Array.from(memo)] }).output;
    if (op) psbt.addOutput({ script: op, value: 0n });
  }
  return psbt.toBase64();
}
