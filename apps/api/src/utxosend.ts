import { BITCOIN_CASH, fromBaseUnits } from "@swapchan/shared";
import { blocktools, btBuildPsbt, btVerifyThorSend } from "./blocktools.js";
import { fetchPrevTxs, type PrevSource } from "./prevtx.js";
import { COINS, type Coin, type CoinRow, coinUtxos } from "./utxochains.js";
import { RouteRefused, UTXO_DEST, validateUtxoRecipient } from "./utxodest.js";

type F = typeof fetch;

/** OP_RETURN data limit per THORChain-only chain, in bytes (THORChain's own per-chain memo limit). */
export const MEMO_LIMIT: Record<string, number> = { ltc: 80, doge: 80, bch: 220 };
/** Most inputs one send spends; more and the user should consolidate first (fee and size grow). */
export const MAX_INPUTS = 50;

/** Full address for blocktools and the explorer: BCH CashAddr gets its "bitcoincash:" prefix back. */
export const fullAddr = (chainId: number, a: string) =>
  chainId === BITCOIN_CASH && !a.includes(":") && /^[qp]/i.test(a) ? `bitcoincash:${a}` : a;

export type UtxoSendSummary = {
  chain: string;
  from: string;
  vault: string;
  amount: string;
  amountDisplay: string;
  change: string;
  fee: string;
  feeDisplay: string;
  memo: string;
  inputs: number;
  /** one-paragraph plain description of what signing does */
  text: string;
};

/**
 * Unsigned LTC/DOGE/BCH PSBT that pays a THORChain vault: [vault = amount, change to the taker, OP_RETURN memo].
 * Keyless: the taker's UTXOs come from the coin's public blockbook; legacy (P2PKH) inputs carry their previous
 * transaction, hash-checked, because the legacy sighash does not commit to the amount. blocktools builds it and
 * then blocktools' verifyThorSend checks it (vault, memo, amount, change, input ownership, output count, no RBF,
 * fee cap) before it is offered: any failure refuses (fail closed). No WASM = no PSBT (no TS fallback).
 */
export async function buildUtxoSend(
  f: F,
  env: NodeJS.ProcessEnv,
  o: {
    chainId: number;
    taker: string;
    vault: string;
    amount: bigint;
    memo: string;
    feeRate: number;
  },
): Promise<{ psbt: string; fee: string; vsize: number; summary: UtxoSendSummary }> {
  const d = UTXO_DEST[o.chainId];
  if (!d) throw new RouteRefused(`chain ${o.chainId} is not a THORChain-only UTXO chain`);
  const v = validateUtxoRecipient(o.chainId, o.taker);
  if (!v.ok) throw new RouteRefused(`sending address: ${v.reason}`);
  if (v.kind !== "P2pkh" && v.kind !== "SegwitV0")
    throw new RouteRefused(
      `${d.name}: SwapChan builds sends from ${d.sym === "LTC" ? "L... or ltc1q..." : d.sym === "DOGE" ? "D..." : "q... (CashAddr P2PKH)"} addresses only; ${v.kind} senders can use the deposit-address option`,
    );
  if (!blocktools())
    throw new Error(
      `blocktools is unavailable, so SwapChan will not offer an unverified ${d.sym} transaction; try again later`,
    );
  const limit = MEMO_LIMIT[d.bt]!;
  const memoBytes = Buffer.byteLength(o.memo, "utf8");
  if (memoBytes > limit)
    throw new RouteRefused(
      `${d.name}: THORChain's memo is ${memoBytes} bytes, over the ${limit}-byte OP_RETURN limit`,
    );
  if (o.amount <= 0n) throw new RouteRefused("amount must be above zero");
  const from = fullAddr(o.chainId, v.address);
  const vault = fullAddr(o.chainId, o.vault);
  const segwit = v.kind === "SegwitV0";
  const rate = Math.max(1, Math.ceil(o.feeRate));
  const c: CoinRow = COINS[d.bt as Coin];
  const all = (await coinUtxos(f, d.bt as Coin, from, env))
    .filter((u) => BigInt(u.value) > 0n)
    .sort((a, b) =>
      BigInt(b.value) > BigInt(a.value) ? 1 : BigInt(b.value) < BigInt(a.value) ? -1 : 0,
    );
  if (!all.length) throw new RouteRefused(`no ${d.sym} found on ${from}`);
  // Generous pre-selection (P2PKH input 148 vB, segwit 68 vB; vault + change + memo outputs). blocktools computes the
  // real fee; this only decides how many coins to hand it.
  const per = BigInt(segwit ? 68 : 148);
  const base = BigInt(10 + 34 + 34 + 11 + memoBytes);
  const take: typeof all = [];
  let total = 0n;
  for (const u of all) {
    if (take.length >= MAX_INPUTS) break;
    take.push(u);
    total += BigInt(u.value);
    if (total >= o.amount + BigInt(rate) * (base + per * BigInt(take.length))) break;
  }
  const need = o.amount + BigInt(rate) * (base + per * BigInt(take.length));
  if (total < need)
    throw new RouteRefused(
      take.length >= MAX_INPUTS && all.length > MAX_INPUTS
        ? `${d.name}: this send needs more than ${MAX_INPUTS} coins (UTXOs); consolidate them in your wallet first`
        : `not enough ${d.sym}: ${fromBaseUnits(total, 8)} available, about ${fromBaseUnits(need, 8)} needed including the network fee`,
    );
  const prev = new Map<string, string>();
  if (!segwit) {
    const ps = (c.prev ?? (c.src && c.src.type !== "cryptoid" ? [c.src] : [])) as PrevSource[];
    if (!ps.length)
      throw new Error(`${d.sym}: no raw-transaction source, so input amounts cannot be proven`);
    const { got, failed } = await fetchPrevTxs(
      f,
      d.bt,
      ps,
      take.map((u) => u.txid),
    );
    const missing = take.filter((u) => !got.has(u.txid.toLowerCase()));
    if (missing.length)
      throw new Error(
        `could not fetch the previous transactions for ${missing.length} of ${take.length} inputs (${[...new Set(failed.values())].slice(0, 2).join("; ") || "explorer unavailable"}); they prove the input amounts, so the ${d.sym} send was not built; try again later`,
      );
    for (const [t, h] of got) prev.set(t, h);
  }
  let built: ReturnType<typeof btBuildPsbt>;
  try {
    built = btBuildPsbt(
      d.bt,
      take.map((u) => ({
        txid: u.txid,
        vout: u.vout,
        amount: u.value,
        address: from,
        prev_tx: prev.get(u.txid.toLowerCase()),
      })),
      vault,
      o.amount,
      from,
      rate,
      Buffer.from(o.memo, "utf8").toString("hex"),
    );
  } catch (e) {
    const m = (e as Error).message;
    if (/insufficient/i.test(m))
      throw new RouteRefused(`not enough ${d.sym} (including the network fee)`);
    throw new Error(`${d.name} PSBT not built: ${m.slice(0, 160)}`);
  }
  // Fee cap: the quoted rate over blocktools' own size plus 10 vB slack (its estimate runs 0-4 vB over).
  const maxFee = BigInt(rate) * BigInt(built.vsize + 10);
  const chk = btVerifyThorSend(d.bt, built.psbt, vault, o.memo, o.amount, from, [from], maxFee);
  if (!chk.ok)
    throw new Error(
      `SwapChan's check refused the ${d.sym} transaction it built (${chk.failures.join(", ") || "unknown"}); nothing to sign`,
    );
  const fee = chk.fee ?? built.fee;
  const amountDisplay = fromBaseUnits(o.amount, 8);
  const feeDisplay = fromBaseUnits(BigInt(fee), 8);
  return {
    psbt: built.psbt,
    fee: String(fee),
    vsize: built.vsize,
    summary: {
      chain: d.sym,
      from: v.address,
      vault: o.vault,
      amount: o.amount.toString(),
      amountDisplay,
      change: v.address,
      fee: String(fee),
      feeDisplay,
      memo: o.memo,
      inputs: take.length,
      text: `Sends ${amountDisplay} ${d.sym} from ${v.address} to THORChain's vault ${o.vault} with the swap instruction "${o.memo}" attached. The rest comes back to ${v.address} as change. Network fee ${feeDisplay} ${d.sym}, ${take.length} input${take.length === 1 ? "" : "s"}. Not replaceable (no RBF).`,
    },
  };
}
