/**
 * find_money freshness: `fresh=1` re-scans one address (its `money:` entry and every per-address
 * cache entry that feeds it), rate-limited per address and globally so it cannot hammer RPCs.
 * Every result carries `asOf` (scan start time, kept on cached responses), `block` (Ethereum
 * block at scan start, EVM addresses only) and `cached` (true when served from the 3-minute cache).
 */
import { cached, clearCachedFor, peekCached } from "./scanner.js";

export const FRESH_PER_ADDRESS_MS = 20_000;
export const FRESH_GLOBAL_WINDOW_MS = 60_000;
export const FRESH_GLOBAL_MAX = 20;

const lastFresh = new Map<string, number>();
let globalFresh: number[] = [];

export function resetFreshLimits() {
  lastFresh.clear();
  globalFresh = [];
}

/** Take one fresh-scan slot for this address, or say how long to wait. */
export function freshGate(
  address: string,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const k = address.toLowerCase();
  const last = lastFresh.get(k);
  if (last !== undefined && now - last < FRESH_PER_ADDRESS_MS)
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((FRESH_PER_ADDRESS_MS - (now - last)) / 1000),
    };
  globalFresh = globalFresh.filter((t) => now - t < FRESH_GLOBAL_WINDOW_MS);
  if (globalFresh.length >= FRESH_GLOBAL_MAX)
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((FRESH_GLOBAL_WINDOW_MS - (now - globalFresh[0]!)) / 1000),
    };
  lastFresh.set(k, now);
  globalFresh.push(now);
  if (lastFresh.size > 5000)
    for (const [a, t] of lastFresh) if (now - t > FRESH_PER_ADDRESS_MS) lastFresh.delete(a);
  return { ok: true };
}

export type Freshness = {
  asOf: string;
  block: number | null;
  cached: boolean;
  freshRefused?: "rate-limited";
  retryAfterSeconds?: number;
};

/**
 * Wrap the cached find_money scan. `latestBlock` is read in parallel with the scan (EVM only)
 * and stored with the result, so a cached response keeps its original asOf and block.
 */
export async function moneyWithFreshness<T extends object>(
  key: string,
  ttlMs: number,
  address: string,
  fresh: boolean,
  latestBlock: (() => Promise<bigint | number | null>) | null,
  scan: () => Promise<T>,
): Promise<T & Freshness> {
  let refused: { retryAfterSeconds: number } | null = null;
  if (fresh) {
    const g = freshGate(address);
    if (g.ok) clearCachedFor(address);
    else refused = g;
  }
  const hit = peekCached(key, ttlMs);
  const r = await cached(key, ttlMs, async () => {
    const asOf = new Date().toISOString();
    const [res, block] = await Promise.all([
      scan(),
      latestBlock ? latestBlock().catch(() => null) : Promise.resolve(null),
    ]);
    return { ...res, asOf, block: block === null ? null : Number(block) };
  });
  // the per-address window runs from when the fresh scan finished, not when it was asked for
  if (fresh && !refused) lastFresh.set(address.toLowerCase(), Date.now());
  return {
    ...r,
    cached: hit,
    ...(refused ? { freshRefused: "rate-limited" as const, ...refused } : {}),
  };
}
