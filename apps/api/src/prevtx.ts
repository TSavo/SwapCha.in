/**
 * Previous-transaction fetch for legacy (non-segwit, non-P2SH) sweep inputs. blocktools (since 5efe3ff) will not
 * build such an input without its previous transaction: the legacy sighash does not commit to the input amount, so
 * a lying explorer amount would become an invisible fee. We fetch the raw tx from the coin's own explorer, check its
 * hash against the txid here (blocktools checks hash + output again), and pass it as `prev_tx`.
 * No signing or key handling: public raw transactions only.
 */
import { createHash } from "node:crypto";

type F = typeof fetch;
export type PrevSource = {
  // iquidus: Iquidus explorer /api/getrawtransaction (plain hex); pbcx: projectblackcoin.org explorer (JSON data.hex)
  type: "blockbook" | "insight" | "qtuminfo" | "woc" | "cryptoid" | "iquidus" | "pbcx";
  urls: string[];
};

export const PREV_LIMITS = {
  pool: 8,
  perRequestMs: 7000,
  deadlineMs: 20_000,
  maxTxBytes: 400_000,
  maxTotalBytes: 8_000_000,
  cacheEntries: 2000,
  wocGapMs: 334,
};

const cache = new Map<string, string>();
/** test hook */
export const resetPrevTxCache = () => {
  cache.clear();
  wocNext = 0;
};
function remember(k: string, hex: string) {
  cache.delete(k);
  cache.set(k, hex);
  while (cache.size > PREV_LIMITS.cacheEntries) cache.delete(cache.keys().next().value!);
}

/** Display txid of raw tx hex: double SHA-256 (single SHA-256 for Groestlcoin), byte-reversed. */
function hashId(b: Buffer, singleSha: boolean): string {
  let h = createHash("sha256").update(b).digest();
  if (!singleSha) h = createHash("sha256").update(h).digest();
  return Buffer.from(h).reverse().toString("hex");
}

// Segwit-serialized tx (marker 0x00, flag != 0; Litecoin MWEB sets flag 0x08): the txid covers
// version | inputs | outputs | locktime only. Returns that stripped form, or null if it does not parse.
export function stripWitness(b: Buffer): Buffer | null {
  if (b.length < 10 || b[4] !== 0 || b[5] === 0) return null;
  let o = 6;
  const vi = () => {
    if (o >= b.length) throw 0;
    const f = b[o]!;
    o++;
    if (f < 0xfd) return f;
    const n = f === 0xfd ? 2 : f === 0xfe ? 4 : 8;
    if (o + n > b.length) throw 0;
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v = v * 256 + b[o + i]!;
    o += n;
    return v;
  };
  const skip = (n: number) => {
    o += n;
    if (o > b.length) throw 0;
  };
  try {
    const start = o;
    const nin = vi();
    for (let i = 0; i < nin; i++) {
      skip(36);
      skip(vi());
      skip(4);
    }
    const nout = vi();
    for (let i = 0; i < nout; i++) {
      skip(8);
      skip(vi());
    }
    const body = b.subarray(start, o);
    return Buffer.concat([b.subarray(0, 4), body, b.subarray(b.length - 4)]);
  } catch {
    return null;
  }
}

/** txid of a raw tx hex; accepts the witness serialization too. */
export function txidOfRaw(hex: string, singleSha = false): string {
  return hashId(Buffer.from(hex, "hex"), singleSha);
}

/** The raw tx in its txid (non-witness) form if it hashes to `txid`, else null. */
export function matchTxid(hex: string, txid: string, singleSha = false): string | null {
  const b = Buffer.from(hex, "hex");
  if (hashId(b, singleSha) === txid) return hex;
  const s = stripWitness(b);
  return s && hashId(s, singleSha) === txid ? s.toString("hex") : null;
}

let wocNext = 0;
async function wocSlot() {
  const now = Date.now();
  const at = Math.max(now, wocNext);
  wocNext = at + PREV_LIMITS.wocGapMs;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const UA = { "user-agent": "Mozilla/5.0 swapchan" };
const HEX = /^[0-9a-f]+$/i;

async function fetchOne(
  f: F,
  srcs: PrevSource[],
  txid: string,
  signal: AbortSignal,
): Promise<string> {
  let last: unknown = "no source";
  for (const [src, base] of srcs.flatMap((s) => s.urls.map((u) => [s, u] as const))) {
    try {
      if (signal.aborted) throw new Error("deadline");
      if (src.type === "woc") await wocSlot();
      const path =
        src.type === "blockbook"
          ? `/api/v2/tx/${txid}`
          : src.type === "insight"
            ? `/rawtx/${txid}`
            : src.type === "qtuminfo"
              ? `/raw-tx/${txid}`
              : src.type === "iquidus"
                ? `/api/getrawtransaction?txid=${txid}&decrypt=0`
                : src.type === "pbcx"
                  ? `/api/explorer/tx/${txid}/hex`
                  : `/tx/${txid}/hex`;
      const r = await f(`${base}${path}`, {
        headers: UA,
        signal: AbortSignal.any([signal, AbortSignal.timeout(PREV_LIMITS.perRequestMs)]),
      });
      if (!r.ok) {
        last = r.status;
        continue;
      }
      const body = (await r.text()).trim();
      if (body.length > PREV_LIMITS.maxTxBytes * 2 + 64) throw new Error("too large");
      let hex = body;
      if (
        src.type === "blockbook" ||
        src.type === "insight" ||
        body.startsWith("{") ||
        body.startsWith('"')
      ) {
        const j = JSON.parse(body) as unknown;
        const o = j as { hex?: unknown; rawtx?: unknown; data?: { hex?: unknown; txid?: unknown } };
        if (src.type === "pbcx" && String(o.data?.txid ?? "").toLowerCase() !== txid)
          throw new Error("explorer answered for another tx");
        hex =
          typeof j === "string"
            ? j
            : String(o.hex ?? o.rawtx ?? (src.type === "pbcx" ? o.data?.hex : "") ?? "");
      }
      if (!hex || hex.length % 2 || !HEX.test(hex)) throw new Error("not hex");
      return hex.toLowerCase();
    } catch (e) {
      last = e;
    }
  }
  throw new Error((last instanceof Error ? last.message : `HTTP ${String(last)}`).slice(0, 60));
}

/**
 * Raw previous txs for `txids` (deduped), each hash-checked. Pool of 8, 7 s per request, 20 s overall,
 * 400 KB per tx, 8 MB total. Returns the ones fetched and verified; the caller decides whether enough remain.
 */
export async function fetchPrevTxs(
  f: F,
  coin: string,
  src: PrevSource | PrevSource[],
  txids: string[],
  singleSha = false,
): Promise<{ got: Map<string, string>; failed: Map<string, string> }> {
  const got = new Map<string, string>();
  const failed = new Map<string, string>();
  const want = [...new Set(txids.map((t) => t.toLowerCase()))];
  const srcs = (Array.isArray(src) ? src : [src]).filter((s) => s.type !== "cryptoid");
  if (!srcs.length) {
    for (const t of want) failed.set(t, "no raw-transaction source");
    return { got, failed };
  }
  const deadline = AbortSignal.timeout(PREV_LIMITS.deadlineMs);
  let total = 0;
  const queue = want.filter((t) => {
    const hit = cache.get(`${coin}:${t}`);
    if (hit) {
      remember(`${coin}:${t}`, hit);
      got.set(t, hit);
      total += hit.length / 2;
    }
    return !hit;
  });
  const worker = async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) {
      try {
        let hex = await fetchOne(f, srcs, t, deadline);
        const n = hex.length / 2;
        if (n > PREV_LIMITS.maxTxBytes) throw new Error("previous tx over 400 KB");
        if (total + n > PREV_LIMITS.maxTotalBytes) throw new Error("previous txs over 8 MB total");
        const m = matchTxid(hex, t, singleSha);
        if (!m) throw new Error("hash does not match txid");
        hex = m;
        total += n;
        remember(`${coin}:${t}`, hex);
        got.set(t, hex);
      } catch (e) {
        failed.set(t, e instanceof Error ? e.message : String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREV_LIMITS.pool, queue.length) }, worker));
  return { got, failed };
}
