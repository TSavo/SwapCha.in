import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import {
  dsTokens,
  SCAN_CHAINS,
  type ScanChain,
  type ScanToken,
  scan,
  tokenRisk,
} from "./scanner.js";

/**
 * SEO pages for trending tokens. A job pulls trending tokens from the scanner, skips risky or
 * illiquid ones, and stores each one once under a stable slug key. Pages never disappear once
 * created; they flip to noindex when liquidity falls below MIN_INDEX_LIQ.
 */
export const SEO_CHAINS: ScanChain[] = ["solana", "base", "eth", "bnb"];
export const MIN_ADD_LIQ = 100_000; // liquidity to create a page
export const MIN_ADD_VOL = 250_000; // 24h volume to create a page
export const MIN_INDEX_LIQ = 25_000; // below this, the page stays up but is noindex

type F = typeof fetch;
/** Majors and stables already have hand-made routes; never generate trending pages for them. */
const SKIP = new Set([
  "usdc",
  "usdt",
  "dai",
  "eth",
  "weth",
  "sol",
  "wsol",
  "bnb",
  "wbnb",
  "wbtc",
  "cbbtc",
  "btcb",
  "usde",
  "usd1",
  "fdusd",
  "pyusd",
]);
export interface SeoToken {
  key: string;
  chain: ScanChain;
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  riskLevel: string;
  riskFlags: string[];
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  indexable: boolean;
  firstSeen: number;
  lastSeen: number;
  checkedAt: number;
}

export function openSeoStore(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS seo_tokens (
      key TEXT PRIMARY KEY, chain TEXT NOT NULL, chain_id INTEGER NOT NULL, address TEXT NOT NULL,
      symbol TEXT NOT NULL, name TEXT NOT NULL, image_url TEXT, risk_level TEXT NOT NULL,
      risk_flags TEXT NOT NULL, liquidity_usd REAL, volume24h_usd REAL, indexable INTEGER NOT NULL,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, checked_at INTEGER NOT NULL,
      UNIQUE(chain, address));
  `);
  return db;
}

const row = (r: Record<string, unknown>): SeoToken => ({
  key: r.key as string,
  chain: r.chain as ScanChain,
  chainId: r.chain_id as number,
  address: r.address as string,
  symbol: r.symbol as string,
  name: r.name as string,
  imageUrl: (r.image_url as string) ?? null,
  riskLevel: r.risk_level as string,
  riskFlags: JSON.parse(r.risk_flags as string) as string[],
  liquidityUsd: (r.liquidity_usd as number) ?? null,
  volume24hUsd: (r.volume24h_usd as number) ?? null,
  indexable: r.indexable === 1,
  firstSeen: r.first_seen as number,
  lastSeen: r.last_seen as number,
  checkedAt: r.checked_at as number,
});

export const listSeo = (db: DatabaseSync): SeoToken[] =>
  (
    db.prepare("SELECT * FROM seo_tokens ORDER BY last_seen DESC").all() as Record<
      string,
      unknown
    >[]
  ).map(row);
export const getSeo = (db: DatabaseSync, key: string): SeoToken | null => {
  const r = db.prepare("SELECT * FROM seo_tokens WHERE key = ?").get(key) as
    | Record<string, unknown>
    | undefined;
  return r ? row(r) : null;
};

/** URL-safe symbol: lowercase alnum, or null when nothing usable is left. */
export const symSlug = (s: string): string | null => {
  const x = s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return x.length ? x : null;
};

/** Stable key: the bare symbol for the first token that claims it; otherwise symbol-chain-addr6. */
export function keyFor(
  db: DatabaseSync,
  chain: ScanChain,
  address: string,
  symbol: string,
): string | null {
  const s = symSlug(symbol);
  if (!s) return null;
  const taken = (k: string) => !!db.prepare("SELECT 1 FROM seo_tokens WHERE key = ?").get(k);
  if (!taken(s)) return s;
  const k = `${s}-${chain}-${address.replace(/^0x/i, "").slice(0, 6).toLowerCase()}`;
  return taken(k) ? null : k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RefreshResult {
  candidates: number;
  added: string[];
  skippedRisk: number;
  updated: number;
}

/** One refresh pass. Upstream calls are sequential with a gap so we stay far under free limits. */
export async function refreshSeo(
  db: DatabaseSync,
  f: F,
  env: NodeJS.ProcessEnv,
  opts: { gapMs?: number; maxNew?: number; now?: number } = {},
): Promise<RefreshResult> {
  const gap = opts.gapMs ?? 1500;
  const now = opts.now ?? Date.now();
  const out: RefreshResult = { candidates: 0, added: [], skippedRisk: 0, updated: 0 };
  const found: ScanToken[] = [];
  for (const chain of SEO_CHAINS) {
    const toks = await scan(f, env, "trending", {
      chain,
      minLiquidityUsd: MIN_ADD_LIQ,
      minVolumeUsd: MIN_ADD_VOL,
      window: "h24",
      limit: 25,
    }).catch(() => [] as ScanToken[]);
    found.push(...toks);
    await sleep(gap);
  }
  out.candidates = found.length;
  const exists = db.prepare("SELECT key FROM seo_tokens WHERE chain = ? AND address = ?");
  const touch = db.prepare(
    "UPDATE seo_tokens SET last_seen = ?, liquidity_usd = ?, volume24h_usd = ?, indexable = ? WHERE key = ?",
  );
  const insert =
    db.prepare(`INSERT INTO seo_tokens (key, chain, chain_id, address, symbol, name, image_url,
    risk_level, risk_flags, liquidity_usd, volume24h_usd, indexable, first_seen, last_seen, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);
  let fresh = 0;
  for (const t of found) {
    if (SKIP.has(t.symbol.toLowerCase())) continue;
    if (t.risk.level === "high") {
      out.skippedRisk++;
      continue;
    }
    const e = exists.get(t.chain, t.address) as { key: string } | undefined;
    if (e) {
      touch.run(
        now,
        t.liquidityUsd,
        t.volumeUsd.h24 ?? null,
        (t.liquidityUsd ?? 0) >= MIN_INDEX_LIQ ? 1 : 0,
        e.key,
      );
      out.updated++;
      continue;
    }
    if (fresh >= (opts.maxNew ?? 20)) continue;
    const r = await tokenRisk(f, env, t.chain, t.address).catch(() => null);
    await sleep(gap);
    if (!r || r.level === "high" || r.level === "unknown") {
      out.skippedRisk++;
      continue;
    }
    const key = keyFor(db, t.chain, t.address, t.symbol);
    if (!key) continue;
    insert.run(
      key,
      t.chain,
      t.chainId,
      t.address,
      t.symbol,
      t.name,
      t.imageUrl,
      r.level,
      JSON.stringify(r.flags.slice(0, 12)),
      t.liquidityUsd,
      t.volumeUsd.h24 ?? null,
      now,
      now,
      now,
    );
    out.added.push(key);
    fresh++;
  }
  // Tokens that fell off the trending lists: refresh liquidity so fading ones go noindex.
  const stale = listSeo(db).filter((s) => s.lastSeen < now);
  for (const chain of SEO_CHAINS) {
    const mine = stale.filter((s) => s.chain === chain);
    if (!mine.length) continue;
    const market = await dsTokens(
      f,
      chain,
      mine.map((s) => s.address),
    ).catch(() => []);
    const by = new Map(market.map((m) => [m.address, m]));
    for (const s of mine) {
      const m = by.get(s.address);
      const liq = m?.liquidityUsd ?? 0;
      db.prepare(
        "UPDATE seo_tokens SET liquidity_usd = ?, volume24h_usd = ?, indexable = ? WHERE key = ?",
      ).run(liq, m?.volumeUsd.h24 ?? null, liq >= MIN_INDEX_LIQ ? 1 : 0, s.key);
      out.updated++;
    }
    await sleep(gap);
  }
  return out;
}

export function seoRoutes(db: DatabaseSync, f: F) {
  const app = new Hono();
  app.get("/tokens", (c) => {
    c.header("cache-control", "public, max-age=300");
    return c.json({ tokens: listSeo(db), minIndexLiquidityUsd: MIN_INDEX_LIQ });
  });
  app.get("/tokens/:key", async (c) => {
    const t = getSeo(db, c.req.param("key"));
    if (!t) return c.json({ error: "not found" }, 404);
    // Live market data (DexScreener, cached 60s in the scanner).
    const [m] = await dsTokens(f, t.chain, [t.address]).catch(() => []);
    c.header("cache-control", "public, max-age=120");
    return c.json({
      token: t,
      market: m
        ? {
            priceUsd: m.priceUsd,
            liquidityUsd: m.liquidityUsd,
            fdvUsd: m.fdvUsd,
            volume24hUsd: m.volumeUsd.h24 ?? null,
            priceChange24hPct: m.priceChangePct.h24 ?? null,
            dex: m.dex,
            pairUrl: m.pairUrl,
            fetchedAt: new Date().toISOString(),
          }
        : null,
      chainId: SCAN_CHAINS[t.chain].chainId,
    });
  });
  return app;
}

/** Background job: first pass shortly after boot, then every intervalMs. */
export function startSeoJob(
  db: DatabaseSync,
  f: F,
  env: NodeJS.ProcessEnv,
  intervalMs = 30 * 60_000,
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await refreshSeo(db, f, env);
      console.log(
        `seo refresh: ${r.candidates} candidates, +${r.added.length} pages, ${r.skippedRisk} risky skipped, ${r.updated} updated`,
      );
    } catch (e) {
      console.error("seo refresh failed", e);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, intervalMs).unref();
}
