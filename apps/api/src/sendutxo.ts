// General UTXO send: move BTC (or a fork/old coin) to an arbitrary recipient as an UNSIGNED PSBT (or
// raw tx for formats without a PSBT) the user signs in their own wallet. Reuses the tested UTXO
// machinery — coinUtxos (fetch), fetchPrevTxs (legacy amount proofs), btBuildPsbt (selection + change),
// utxoSweep (send-all) — and re-checks the built transaction with verifyTx against the recipient.
// Unlike buildUtxoSend (THORChain only: a vault + memo), this pays an arbitrary address with no memo.
import { fromBaseUnits } from "@swapchan/shared";
import { blocktools, btAddrValid, btBuildPsbt } from "./blocktools.js";
import { fetchPrevTxs, type PrevSource } from "./prevtx.js";
import { COINS, type Coin, type CoinRow, coinUtxos, utxoSweep } from "./utxochains.js";

type F = typeof fetch;

/** Most inputs one send spends; past this the user should consolidate first (fee and size grow). */
const MAX_INPUTS = 50;

export type UtxoSendPlan = {
  family: "utxo";
  coin: string;
  recipient: string;
  from: string;
  amount: string; // decimal, or "max"
  /** base64 PSBT for PSBT formats; null for raw-only formats (then `unsignedTx` is set) */
  psbt: string | null;
  unsignedTx?: string | undefined;
  fee: string;
  vsize?: number | undefined;
  verify: { ok: boolean; failures: string[]; warnings: string[] } | null;
  wallet: string; // the wallet to sign this in
};

/** decimal string -> integer base units for a coin with `decimals` places (no float). */
function toBaseUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  if (frac.length > decimals) throw new Error(`more than ${decimals} decimal places`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Independent guard: verifyTx re-reads the built tx/PSBT and checks it pays `recipient`, change to `from`, fee ≤ cap. */
function verifyUtxo(coin: string, txOrPsbt: string, recipient: string, change: string, maxFee: bigint) {
  const w = blocktools();
  if (!w) return null;
  const v = JSON.parse(
    w.verifyTx(txOrPsbt, coin, [recipient], [change], undefined, maxFee.toString(), false, null, null),
  ) as { ok?: boolean; failures?: string[]; warnings?: string[] };
  return { ok: v.ok === true, failures: v.failures ?? [], warnings: v.warnings ?? [] };
}

export async function buildUtxoSend(
  f: F,
  env: NodeJS.ProcessEnv,
  o: { coin: string; to: string; amount: string; from?: string | undefined },
): Promise<UtxoSendPlan> {
  const coin = o.coin.toLowerCase() as Coin;
  const c: CoinRow | undefined = COINS[coin];
  if (!c) throw new Error(`unknown coin "${o.coin}"`);
  if (!blocktools())
    throw new Error(`blocktools is unavailable, so SwapChan won't offer an unverified ${c.sym} transaction; try again later`);
  if (!o.from) throw new Error("the sending address (from) is required for a UTXO send");
  const from = o.from.trim();
  const to = o.to.trim();
  if (!btAddrValid(coin, from)) throw new Error(`"${from}" is not a valid ${c.sym} address (sender)`);
  if (!btAddrValid(coin, to)) throw new Error(`"${to}" is not a valid ${c.sym} address (recipient)`);

  // "max": sweep everything to the recipient (reuses the fully-tested per-coin sweep: legacy prevtx, pos-ntime, zec, groestl).
  if (o.amount.trim().toLowerCase() === "max") {
    if (!c.sweep) throw new Error(`send-all isn't supported for ${c.sym} yet; give a specific amount`);
    const s = (await utxoSweep(f, coin, from, to, c.feeRate)) as {
      psbt?: string;
      unsigned_tx?: string;
      fee: string | number;
      vsize?: number;
    };
    const txOrPsbt = s.psbt ?? s.unsigned_tx!;
    const maxFee = BigInt(Math.ceil(Number(s.fee) * 1.1) + 1000);
    const verify = verifyUtxo(coin, txOrPsbt, to, to, maxFee); // sweep has no change (one output to the recipient)
    return {
      family: "utxo",
      coin,
      recipient: to,
      from,
      amount: "max",
      psbt: s.psbt ?? null,
      unsignedTx: s.unsigned_tx,
      fee: String(s.fee),
      vsize: s.vsize,
      verify,
      wallet: c.wallet,
    };
  }

  const amount = toBaseUnits(o.amount, c.decimals);
  if (amount <= 0n) throw new Error("amount must be above zero");
  const rate = Math.max(1, Math.ceil(c.feeRate));
  const segwitSender = /^(bc1q|ltc1q|[a-z]+1q)/.test(from.toLowerCase());

  const all = (await coinUtxos(f, coin, from, env))
    .filter((u) => BigInt(u.value) > 0n)
    .sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : BigInt(b.value) < BigInt(a.value) ? -1 : 0));
  if (!all.length) throw new Error(`no ${c.sym} found on ${from}`);

  // Generous pre-selection; btBuildPsbt computes the real fee and change. Input ~148 vB legacy / ~68 vB segwit.
  const per = BigInt(segwitSender ? 68 : 148);
  const base = BigInt(10 + 34 + 34 + 11);
  const take: typeof all = [];
  let total = 0n;
  for (const u of all) {
    if (take.length >= MAX_INPUTS) break;
    take.push(u);
    total += BigInt(u.value);
    if (total >= amount + BigInt(rate) * (base + per * BigInt(take.length))) break;
  }
  const need = amount + BigInt(rate) * (base + per * BigInt(take.length));
  if (total < need)
    throw new Error(
      take.length >= MAX_INPUTS && all.length > MAX_INPUTS
        ? `this send needs more than ${MAX_INPUTS} coins (UTXOs); consolidate them first`
        : `not enough ${c.sym}: ${fromBaseUnits(total, c.decimals)} available, about ${fromBaseUnits(need, c.decimals)} needed including the fee`,
    );

  // Legacy / bare-P2SH / pos-ntime inputs must carry their previous tx (the legacy sighash does not commit to amounts).
  const prev = new Map<string, string>();
  if (!segwitSender) {
    const ps = (c.prev ?? (c.src && c.src.type !== "cryptoid" ? [c.src] : [])) as PrevSource[];
    if (!ps.length) throw new Error(`${c.sym}: no raw-transaction source, so input amounts can't be proven`);
    const { got, failed } = await fetchPrevTxs(f, coin, ps, take.map((u) => u.txid));
    const missing = take.filter((u) => !got.has(u.txid.toLowerCase()));
    if (missing.length)
      throw new Error(
        `could not fetch the previous transactions for ${missing.length} of ${take.length} inputs (${[...new Set(failed.values())].slice(0, 2).join("; ") || "explorer unavailable"}); the ${c.sym} send was not built`,
      );
    for (const [t, h] of got) prev.set(t, h);
  }

  let built: ReturnType<typeof btBuildPsbt>;
  try {
    built = btBuildPsbt(
      coin,
      take.map((u) => ({ txid: u.txid, vout: u.vout, amount: u.value, address: from, prev_tx: prev.get(u.txid.toLowerCase()) })),
      to,
      amount,
      from, // change back to the sender
      rate,
      "", // no memo
    );
  } catch (e) {
    const m = (e as Error).message;
    if (/insufficient/i.test(m)) throw new Error(`not enough ${c.sym} (including the network fee)`);
    throw new Error(`${c.name} PSBT not built: ${m.slice(0, 160)}`);
  }

  const maxFee = BigInt(rate) * BigInt(built.vsize + 10);
  const verify = verifyUtxo(coin, built.psbt, to, from, maxFee);
  return {
    family: "utxo",
    coin,
    recipient: to,
    from,
    amount: o.amount,
    psbt: built.psbt,
    fee: String(built.fee),
    vsize: built.vsize,
    verify,
    wallet: c.wallet,
  };
}
