import { trustedClientIp } from "./clientip.js";
/**
 * find_money freshness: `fresh=1` re-scans one address (its `money:` entry and every per-address
 * cache entry that feeds it), rate-limited per address and globally so it cannot hammer RPCs.
 * Every result carries `asOf` (scan start time, kept on cached responses), `block` (Ethereum
 * block at scan start, EVM addresses only) and `cached` (true when served from the 3-minute cache).
 */
import { cached, clearCachedFor, peekCached } from "./scanner.js";

export const FRESH_PER_ADDRESS_MS = 20_000;
export const FRESH_GLOBAL_WINDOW_MS = 60_000;
/** Backstop across all clients; the per-IP limit below is the real fairness limit. */
export const FRESH_GLOBAL_MAX = 20;
export const FRESH_PER_IP_MAX = 3;
export const BLOCK_READ_TIMEOUT_MS = 3_000;

const lastFresh = new Map<string, number>();
const inFlight = new Set<string>();
const perIp = new Map<string, number[]>();
let globalFresh: number[] = [];

export function resetFreshLimits() {
  lastFresh.clear();
  inFlight.clear();
  perIp.clear();
  globalFresh = [];
}

/** Client key: the proxy-set client IP, same source as the dev-tools rate limit; kept only for the 60s window. */
export const clientIpOf = (h: (n: string) => string | undefined, remoteAddress?: string) =>
  trustedClientIp(h, remoteAddress);

/** Take one fresh-scan slot for this address, or say how long to wait. */
export function freshGate(
  address: string,
  now = Date.now(),
  client = "local",
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const k = address.toLowerCase();
  // a fresh scan for this address is still running: never clear or replace it
  if (inFlight.has(k))
    return { ok: false, retryAfterSeconds: Math.ceil(FRESH_PER_ADDRESS_MS / 1000) };
  const last = lastFresh.get(k);
  if (last !== undefined && now - last < FRESH_PER_ADDRESS_MS)
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((FRESH_PER_ADDRESS_MS - (now - last)) / 1000),
    };
  const mine = (perIp.get(client) ?? []).filter((t) => now - t < FRESH_GLOBAL_WINDOW_MS);
  if (mine.length >= FRESH_PER_IP_MAX)
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((FRESH_GLOBAL_WINDOW_MS - (now - mine[0]!)) / 1000),
    };
  globalFresh = globalFresh.filter((t) => now - t < FRESH_GLOBAL_WINDOW_MS);
  if (globalFresh.length >= FRESH_GLOBAL_MAX)
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((FRESH_GLOBAL_WINDOW_MS - (now - globalFresh[0]!)) / 1000),
    };
  lastFresh.set(k, now);
  mine.push(now);
  perIp.set(client, mine);
  globalFresh.push(now);
  if (perIp.size > 5000)
    for (const [ip, ts] of perIp)
      if (!ts.some((t) => now - t < FRESH_GLOBAL_WINDOW_MS)) perIp.delete(ip);
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
  client = "local",
): Promise<T & Freshness> {
  let refused: { retryAfterSeconds: number } | null = null;
  const k = address.toLowerCase();
  let mine = false;
  if (fresh) {
    const g = freshGate(address, Date.now(), client);
    if (g.ok) {
      clearCachedFor(address);
      inFlight.add(k);
      mine = true;
    } else refused = g;
  }
  const hit = peekCached(key, ttlMs);
  const r = await cached(key, ttlMs, async () => {
    const asOf = new Date().toISOString();
    const [res, block] = await Promise.all([
      scan(),
      latestBlock ? withTimeout(latestBlock(), BLOCK_READ_TIMEOUT_MS) : Promise.resolve(null),
    ]);
    return { ...res, asOf, block: block === null ? null : Number(block) };
  }).finally(() => {
    if (!mine) return;
    // the per-address window runs from when the fresh scan finished (it was also stamped at start)
    inFlight.delete(k);
    lastFresh.set(k, Date.now());
  });
  return {
    ...r,
    cached: hit,
    ...(refused ? { freshRefused: "rate-limited" as const, ...refused } : {}),
  };
}

/** Resolve to null when the read fails or takes longer than ms (the block number is informational). */
function withTimeout<V>(p: Promise<V>, ms: number): Promise<V | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((res) => {
      timer = setTimeout(() => res(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
