/**
 * Relay of ALREADY-SIGNED transactions to the chains in @swapchan/shared BROADCAST_EXTRA (the 12 core chains stay in
 * txtools.ts). SwapChan never signs, never derives keys and cannot alter signed bytes: each payload gets only a
 * minimal sanity check (encoding, not a PSBT, EVM chainId match + signature present) and is posted unchanged to a
 * free public node. A clear node rejection is returned as-is (not retried elsewhere); only network failures fall
 * through to the next endpoint. verify_tx cannot decode these chains, so strict=true refuses them (fail closed).
 */
import { BROADCAST_CHAINS, BROADCAST_EXTRA, type BroadcastChain } from "@swapchan/shared";
import { parseTransaction, recoverTransactionAddress, type TransactionSerialized } from "viem";
import { btKeccak256 } from "./blocktools.js";
import { BadRequest } from "./onchain.js";

type F = typeof fetch;
type Out = Record<string, unknown> & { broadcast: boolean };

/** Resolve a broadcast-only chain by key, EVM chain id, slug or name (case-insensitive); null when not one. */
export function extraBroadcastChain(v: string | number): BroadcastChain | null {
  const s = String(v).trim().toLowerCase();
  return (
    BROADCAST_EXTRA.find(
      (c) =>
        c.key === s ||
        (c.chainId !== undefined && String(c.chainId) === s) ||
        c.slug === s ||
        c.name.toLowerCase() === s,
    ) ?? null
  );
}

const HEX = /^[0-9a-fA-F]+$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const needHex = (raw: string, what: string, prefixed = false) => {
  const body = prefixed ? raw.replace(/^0x/, "") : raw;
  if ((prefixed && !raw.startsWith("0x")) || !HEX.test(body) || body.length % 2)
    throw new BadRequest(`${what} must be ${prefixed ? "0x-prefixed " : ""}hex`);
  return body;
};
const needB64 = (raw: string, what: string) => {
  const t = raw.replace(/\s+/g, "");
  if (!B64.test(t) || t.length % 4) throw new BadRequest(`${what} must be base64`);
  return t;
};
const short = (s: unknown) =>
  String(s ?? "")
    .replace(/https?:\/\/\S+/g, "[url]")
    .slice(0, 300);

class NodeRejected extends Error {}
/** Try each endpoint in order; a NodeRejected answer is final, any other failure falls through. */
async function each<T>(c: BroadcastChain, eps: string[], fn: (ep: string) => Promise<T>) {
  for (const ep of eps) {
    try {
      return { ok: true as const, v: await fn(ep) };
    } catch (e) {
      if (e instanceof NodeRejected)
        return { ok: false as const, reason: `node rejected: ${short(e.message)}` };
    }
  }
  return { ok: false as const, reason: `no ${c.name} endpoint answered; nothing was broadcast` };
}
async function post(f: F, url: string, body: string | Uint8Array, type: string, ms = 20_000) {
  const r = await f(url, {
    method: "POST",
    headers: { "content-type": type },
    body,
    signal: AbortSignal.timeout(ms),
  });
  const text = await r.text();
  let j: unknown = null;
  try {
    j = JSON.parse(text);
  } catch {}
  return { status: r.status, text, j: j as Record<string, any> | null };
}
const jsonRpc = async (f: F, ep: string, method: string, params: unknown[]) => {
  const r = await post(
    f,
    ep,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    "application/json",
  );
  if (r.j?.error) throw new NodeRejected(r.j.error.message ?? JSON.stringify(r.j.error));
  if (typeof r.j?.result !== "string") throw new Error(`bad reply ${r.status}`);
  return r.j.result as string;
};

export async function broadcastExtra(
  f: F,
  env: NodeJS.ProcessEnv,
  c: BroadcastChain,
  tx: unknown,
  strict = false,
): Promise<Out> {
  if (typeof tx !== "string") throw new BadRequest(`${c.name}: tx must be a string (${c.format})`);
  const raw = tx.trim();
  const base = { chain: c.name, family: c.family };
  let pre: Record<string, unknown> = {};
  let send: (ep: string) => Promise<string>;
  let eps = c.endpoints;
  switch (c.family) {
    case "evm": {
      needHex(raw, "EVM tx", true);
      let p: ReturnType<typeof parseTransaction>;
      try {
        p = parseTransaction(raw as TransactionSerialized);
      } catch (e) {
        throw new BadRequest(`not a valid signed EVM tx: ${(e as Error).message.split("\n")[0]}`);
      }
      if (p.chainId === undefined)
        throw new BadRequest(
          `${c.name}: tx has no chainId (pre-EIP-155, replayable on other chains); sign it with chainId ${c.chainId}`,
        );
      if (p.chainId !== c.chainId)
        throw new BadRequest(`signed for chain ${p.chainId}, not ${c.chainId}`);
      if (!p.r || !p.s) throw new BadRequest("tx is not signed");
      const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
      pre = { hash: btKeccak256(raw), from };
      eps = [env[`RPC_URL_${c.chainId}`], ...c.endpoints].filter((u): u is string => !!u);
      send = (ep) => jsonRpc(f, ep, "eth_sendRawTransaction", [raw]);
      break;
    }
    case "utxo": {
      needHex(raw, `${c.name} tx`);
      if (/^70736274ff/i.test(raw))
        throw new BadRequest(
          "that is a PSBT (unsigned/partially signed); finalize it in your wallet and send the raw tx hex",
        );
      if (raw.length < 120) throw new BadRequest(`${c.name}: too short to be a signed transaction`);
      send = async (ep) => {
        if (c.api === "blockbook") {
          const r = await post(f, `${ep}/api/v2/sendtx/`, raw, "text/plain");
          if (typeof r.j?.result === "string") return r.j.result;
          if (r.j?.error) throw new NodeRejected(r.j.error.message ?? r.j.error);
          throw new Error(`bad reply ${r.status}`);
        }
        if (c.api === "insight") {
          const r = await post(
            f,
            `${ep}/tx/send`,
            JSON.stringify({ rawtx: raw }),
            "application/json",
          );
          if (typeof r.j?.txid === "string") return r.j.txid;
          if (r.status >= 400 && r.status < 500) throw new NodeRejected(r.text);
          throw new Error(`bad reply ${r.status}`);
        }
        const r = await post(f, `${ep}/tx/raw`, JSON.stringify({ txhex: raw }), "application/json");
        if (r.status === 200 && typeof r.j === "string") return r.j as unknown as string;
        if (r.status >= 400 && r.status < 500) throw new NodeRejected(r.text);
        throw new Error(`bad reply ${r.status}`);
      };
      break;
    }
    case "xrp": {
      needHex(raw, "XRP tx_blob");
      send = async (ep) => {
        const r = await post(
          f,
          ep,
          JSON.stringify({ method: "submit", params: [{ tx_blob: raw }] }),
          "application/json",
        );
        const res = r.j?.result;
        if (!res) throw new Error(`bad reply ${r.status}`);
        if (res.status === "error") throw new NodeRejected(res.error_message ?? res.error);
        const code = String(res.engine_result ?? "");
        if (!(res.accepted === true || /^tes|^terQUEUED/.test(code)))
          throw new NodeRejected(`${code} ${res.engine_result_message ?? ""}`.trim());
        return String(res.tx_json?.hash ?? "");
      };
      break;
    }
    case "stellar": {
      const b = needB64(raw, "Stellar envelope XDR");
      send = async (ep) => {
        const r = await post(
          f,
          `${ep}/transactions`,
          new URLSearchParams({ tx: b }).toString(),
          "application/x-www-form-urlencoded",
          60_000,
        );
        if (r.status === 200 && typeof r.j?.hash === "string") return r.j.hash;
        if (r.status === 400)
          throw new NodeRejected(JSON.stringify(r.j?.extras?.result_codes ?? r.j?.title ?? r.text));
        throw new Error(`bad reply ${r.status}`);
      };
      break;
    }
    case "algorand": {
      const bytes = Buffer.from(needB64(raw, "Algorand signed txn"), "base64");
      send = async (ep) => {
        const r = await post(f, `${ep}/v2/transactions`, bytes, "application/x-binary");
        if (r.status === 200 && typeof r.j?.txId === "string") return r.j.txId;
        if (r.status === 400) throw new NodeRejected(r.j?.message ?? r.text);
        throw new Error(`bad reply ${r.status}`);
      };
      break;
    }
    case "cosmos": {
      const b = needB64(raw, "Cosmos TxRaw bytes");
      send = async (ep) => {
        const r = await post(
          f,
          `${ep}/cosmos/tx/v1beta1/txs`,
          JSON.stringify({ tx_bytes: b, mode: "BROADCAST_MODE_SYNC" }),
          "application/json",
        );
        const t = r.j?.tx_response;
        if (!t) {
          if (r.status === 400) throw new NodeRejected(r.j?.message ?? r.text);
          throw new Error(`bad reply ${r.status}`);
        }
        if (Number(t.code) !== 0) throw new NodeRejected(`code ${t.code}: ${t.raw_log ?? ""}`);
        return String(t.txhash);
      };
      break;
    }
    case "polkadot": {
      needHex(raw, "Polkadot extrinsic", true);
      send = (ep) => jsonRpc(f, ep, "author_submitExtrinsic", [raw]);
      break;
    }
    case "ton": {
      const b = needB64(raw, "TON BoC");
      send = async (ep) => {
        const r = await post(
          f,
          `${ep}/sendBocReturnHash`,
          JSON.stringify({ boc: b }),
          "application/json",
        );
        if (r.j?.ok === true) return String(r.j.result?.hash ?? "");
        if (r.j?.ok === false && r.status !== 429) throw new NodeRejected(r.j.error ?? r.text);
        throw new Error(`bad reply ${r.status}`);
      };
      break;
    }
    case "cardano": {
      const bytes = Buffer.from(needHex(raw, "Cardano tx CBOR"), "hex");
      send = async (ep) => {
        const r = await post(f, `${ep}/submittx`, bytes, "application/cbor");
        if (r.status === 202 || r.status === 200) return String(r.j ?? r.text).replace(/"/g, "");
        if (r.status === 400) throw new NodeRejected(r.text);
        throw new Error(`bad reply ${r.status}`);
      };
      break;
    }
    default:
      throw new BadRequest(`${c.name}: broadcast not supported`);
  }
  if (strict)
    return {
      broadcast: false,
      reason: `strict: verify_tx cannot decode ${c.name} transactions, so strict mode refuses; send without strict to relay it unchanged`,
      ...base,
      ...pre,
    };
  const r = await each(c, eps, send);
  if (!r.ok) return { broadcast: false, reason: r.reason, ...base, ...pre };
  const hash = r.v || (pre.hash as string | undefined) || null;
  return {
    broadcast: true,
    hash,
    ...base,
    ...(pre.from ? { from: pre.from } : {}),
    via: "public node",
    explorer: c.explorerTx && hash ? `${c.explorerTx}${hash}` : null,
    note: "Relayed unchanged. verify_tx cannot decode this chain; SwapChan did not check what the tx does.",
  };
}

/**
 * Pick the path for /onchain/broadcast: the 12 core chains go to txtools.broadcastTx unchanged; the extra chains to
 * broadcastExtra; anything else is a clear "not supported" error listing what is.
 */
export function routeBroadcast(
  v: string | number,
  chainOf: (v: string | number) => number,
): { core: number } | { extra: BroadcastChain } {
  const x = typeof v === "number" || /^\d+$/.test(String(v)) ? extraBroadcastChain(v) : null;
  if (x) return { extra: x };
  try {
    return { core: chainOf(v) };
  } catch {
    const e = extraBroadcastChain(v);
    if (e) return { extra: e };
    throw new BadRequest(
      `broadcast_tx does not support chain ${String(v).slice(0, 40)}. Supported: ${BROADCAST_CHAINS.map((c) => c.key).join(", ")}. For any other chain, broadcast from the coin's own wallet.`,
    );
  }
}

/** Per-client fixed 60 s window, same shape as the dev-tools limiter; IPs are kept only for the window. */
export function broadcastLimiter(perMinute = 10, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return (who: string): { ok: true } | { ok: false; retryAfter: number } => {
    const t = now();
    let w = windows.get(who);
    if (!w || t - w.start >= 60_000) {
      w = { start: t, count: 0 };
      windows.set(who, w);
      if (windows.size > 50_000) windows.clear();
    }
    w.count++;
    return w.count > perMinute
      ? { ok: false, retryAfter: Math.ceil((w.start + 60_000 - t) / 1000) }
      : { ok: true };
  };
}
