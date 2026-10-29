// Tron send: an UNSIGNED TRX transfer the user signs in their own wallet. blocktools (tronBuildTransfer,
// keyless) builds the raw_data from a fresh block reference fetched from the Tron node; we then decode the
// built transaction (tronDecodeTx) and confirm it pays the intended recipient and amount. SwapChan never
// signs or broadcasts. TRC-20 (e.g. USDT) is the next step (it needs the token's decimals + a fee limit).
import { blocktools } from "./blocktools.js";

type F = typeof fetch;

export type TronSendPlan = {
  family: "tron";
  recipient: string;
  from: string;
  token: string | null; // TRC-20 contract (T…), or null for native TRX
  amount: string;
  tx: { rawDataHex: string };
  verify: { ok: boolean; failures: string[]; warnings: string[] } | null;
  wallet: string;
};

/** TRC-20 fee (energy) cap in sun; must stay under blocktools' DEFAULT_MAX_FEE_LIMIT_SUN (150 TRX). */
const TRC20_FEE_LIMIT_SUN = 100_000_000; // 100 TRX

function toUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  if (frac.length > decimals) throw new Error(`more than ${decimals} decimal places`);
  return (
    BigInt(whole || "0") * 10n ** BigInt(decimals) +
    BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
}

/** Read a TRC-20 contract's decimals via a constant (read-only) call to the Tron node. */
async function trc20Decimals(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: string,
  contract: string,
): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = env.TRONGRID_API_KEY;
  const r = await f("https://api.trongrid.io/wallet/triggerconstantcontract", {
    method: "POST",
    headers,
    body: JSON.stringify({
      owner_address: owner,
      contract_address: contract,
      function_selector: "decimals()",
      visible: true,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const j = (await r.json()) as { constant_result?: string[] };
  const hex = j.constant_result?.[0];
  if (!hex) throw new Error(`"${contract}" is not a TRC-20 (no decimals())`);
  const d = Number(BigInt(`0x${hex}`));
  if (!Number.isInteger(d) || d < 0 || d > 30) throw new Error("bad TRC-20 decimals");
  return d;
}

/** Latest block → the ref_block fields a Tron tx must carry (so it can't be replayed on a stale chain tip). */
async function tronRefBlock(f: F, env: NodeJS.ProcessEnv): Promise<{ bytes: string; hash: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = env.TRONGRID_API_KEY;
  const r = await f("https://api.trongrid.io/wallet/getnowblock", {
    method: "POST",
    headers,
    body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  const j = (await r.json()) as {
    blockID?: string;
    block_header?: { raw_data?: { number?: number } };
  };
  const id = j.blockID;
  const num = j.block_header?.raw_data?.number;
  if (!id || num === undefined) throw new Error("could not read the current Tron block; try again");
  // ref_block_bytes: the low 2 bytes of the block number (big-endian). ref_block_hash: blockID bytes 8..16.
  const bytes = (num & 0xffff).toString(16).padStart(4, "0");
  const hash = id.slice(16, 32);
  if (hash.length !== 16) throw new Error("unexpected Tron blockID");
  return { bytes, hash };
}

export async function buildTronSend(
  f: F,
  env: NodeJS.ProcessEnv,
  o: { to: string; amount: string; token?: string | undefined; from?: string | undefined },
): Promise<TronSendPlan> {
  const w = blocktools();
  if (!w) throw new Error("blocktools is unavailable; not offering an unverified Tron transaction");
  if (!o.from) throw new Error("the sending address (from) is required for a Tron send");
  const from = o.from.trim();
  const to = o.to.trim();
  if (from === to) throw new Error("the sender and recipient are the same address");
  const t = o.token?.trim();
  const isTrc20 = !!t && t.toLowerCase() !== "native" && t.toLowerCase() !== "trx";

  const ref = await tronRefBlock(f, env);
  const now = Date.now();
  const base = {
    from,
    to,
    ref_block_bytes: ref.bytes,
    ref_block_hash: ref.hash,
    timestamp_ms: now,
    expiration_ms: now + 60_000,
  };

  let plan: Record<string, unknown>;
  let token: string | null = null;
  let wantAmount: string; // base units we expect the decode to confirm
  if (isTrc20) {
    const decimals = await trc20Decimals(f, env, from, t!);
    const amt = toUnits(o.amount, decimals);
    if (amt <= 0n) throw new Error("amount must be above zero");
    token = t!;
    wantAmount = amt.toString();
    plan = { ...base, trc20: { contract: t, amount: wantAmount, fee_limit_sun: TRC20_FEE_LIMIT_SUN } };
  } else {
    const sun = toUnits(o.amount, 6); // TRX has 6 decimals
    if (sun <= 0n) throw new Error("amount must be above zero");
    wantAmount = sun.toString();
    plan = { ...base, amount_sun: wantAmount };
  }

  let rawDataHex: string;
  try {
    rawDataHex = w.tronBuildTransfer(JSON.stringify(plan));
  } catch (e) {
    throw new Error(`Tron transaction not built: ${e instanceof Error ? e.message : "bad plan"}`);
  }

  // Guard: decode the built raw_data and confirm it pays `to` the intended `amount` (and token), from `from`.
  const failures: string[] = [];
  try {
    const d = JSON.parse(w.tronDecodeTx(rawDataHex)) as {
      contracts?: {
        type?: string;
        owner?: string;
        to?: string;
        amount_sun?: string;
        contract?: string;
        trc20_transfer?: { to?: string; amount?: string };
      }[];
    };
    const ct = d.contracts?.[0];
    if (!ct) failures.push("no_contract");
    else if (isTrc20) {
      if (ct.type !== "TriggerSmartContract" || !ct.trc20_transfer) failures.push("not_a_trc20_transfer");
      else {
        if (ct.trc20_transfer.to !== to) failures.push("recipient_mismatch");
        if (ct.trc20_transfer.amount !== wantAmount) failures.push("amount_mismatch");
        if (ct.contract !== token) failures.push("wrong_contract");
      }
      if (ct.owner !== from) failures.push("sender_mismatch");
    } else {
      if (ct.type !== "TransferContract") failures.push("not_a_trx_transfer");
      else {
        if (ct.to !== to) failures.push("recipient_mismatch");
        if (ct.amount_sun !== wantAmount) failures.push("amount_mismatch");
        if (ct.owner !== from) failures.push("sender_mismatch");
      }
    }
  } catch {
    failures.push("decode_failed");
  }

  return {
    family: "tron",
    recipient: to,
    from,
    token,
    amount: o.amount,
    tx: { rawDataHex },
    verify: { ok: failures.length === 0, failures, warnings: [] },
    wallet: "a Tron wallet (TronLink)",
  };
}
