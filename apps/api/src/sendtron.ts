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
  token: null; // native TRX for now
  amount: string;
  tx: { rawDataHex: string };
  verify: { ok: boolean; failures: string[]; warnings: string[] } | null;
  wallet: string;
};

function toSun(amount: string): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  if (frac.length > 6) throw new Error("more than 6 decimal places (TRX has 6)");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6) || "0");
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
  if (o.token && o.token.trim().toLowerCase() !== "native" && o.token.trim().toLowerCase() !== "trx")
    throw new Error("TRC-20 sends (e.g. USDT) are coming; for now this sends native TRX only");

  const sun = toSun(o.amount);
  if (sun <= 0n) throw new Error("amount must be above zero");

  const ref = await tronRefBlock(f, env);
  const now = Date.now();
  const plan = {
    from,
    to,
    ref_block_bytes: ref.bytes,
    ref_block_hash: ref.hash,
    timestamp_ms: now,
    expiration_ms: now + 60_000,
    amount: sun.toString(),
  };

  let rawDataHex: string;
  try {
    rawDataHex = w.tronBuildTransfer(JSON.stringify(plan));
  } catch (e) {
    throw new Error(`Tron transaction not built: ${e instanceof Error ? e.message : "bad plan"}`);
  }

  // Guard: decode the built raw_data and confirm it pays `to` the intended `amount`, from `from`.
  const failures: string[] = [];
  try {
    const d = JSON.parse(w.tronDecodeTx(rawDataHex)) as {
      contracts?: { type?: string; owner?: string; to?: string; amount_sun?: string }[];
    };
    const ct = d.contracts?.[0];
    if (!ct || ct.type !== "TransferContract") failures.push("not_a_trx_transfer");
    else {
      if (ct.to !== to) failures.push("recipient_mismatch");
      if (ct.amount_sun !== sun.toString()) failures.push("amount_mismatch");
      if (ct.owner !== from) failures.push("sender_mismatch");
    }
  } catch {
    failures.push("decode_failed");
  }

  return {
    family: "tron",
    recipient: to,
    from,
    token: null,
    amount: o.amount,
    tx: { rawDataHex },
    verify: { ok: failures.length === 0, failures, warnings: [] },
    wallet: "a Tron wallet (TronLink)",
  };
}
