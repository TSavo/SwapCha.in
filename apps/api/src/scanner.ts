import { nativeOf, SOLANA } from "@swapchan/shared";
import { Hono } from "hono";
import { z } from "zod";

/** Memecoin scanner: DexScreener + GeckoTerminal + Jupiter (Solana) + RugCheck / GoPlus risk.
 * Every upstream call is cached in-process so we stay far under their free rate limits. */

export const SCAN_CHAINS = {
  solana: { chainId: SOLANA, gt: "solana", ds: "solana", goplus: null },
  base: { chainId: 8453, gt: "base", ds: "base", goplus: "8453" },
  bnb: { chainId: 56, gt: "bsc", ds: "bsc", goplus: "56" },
  eth: { chainId: 1, gt: "eth", ds: "ethereum", goplus: "1" },
  arbitrum: { chainId: 42161, gt: "arbitrum", ds: "arbitrum", goplus: "42161" },
  polygon: { chainId: 137, gt: "polygon_pos", ds: "polygon", goplus: "137" },
  optimism: { chainId: 10, gt: "optimism", ds: "optimism", goplus: "10" },
  avalanche: { chainId: 43114, gt: "avax", ds: "avalanche", goplus: "43114" },
} as const;
export type ScanChain = keyof typeof SCAN_CHAINS;
const DS_TO_CHAIN = Object.fromEntries(
  Object.entries(SCAN_CHAINS).map(([k, v]) => [v.ds, k as ScanChain]),
) as Record<string, ScanChain>;
const GT_TO_CHAIN = Object.fromEntries(
  Object.entries(SCAN_CHAINS).map(([k, v]) => [v.gt, k as ScanChain]),
) as Record<string, ScanChain>;

export const SITE = "https://swapchan.com";
export const RISK_DISCLAIMER =
  "Not financial advice. New and trending tokens are extremely risky: many are rugs, honeypots or pump-and-dumps. Risk checks are automated heuristics and can miss things. Only swap what you can afford to lose.";

export type Window = "m5" | "h1" | "h6" | "h24";
export interface ScanToken {
  chain: ScanChain;
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  volumeUsd: Partial<Record<Window, number>>;
  priceChangePct: Partial<Record<Window, number>>;
  pairCreatedAt: string | null;
  ageHours: number | null;
  dex: string | null;
  pairUrl: string | null;
  boosts?: number;
  risk: QuickRisk;
  swapUrl: string;
}
export interface QuickRisk {
  level: "low" | "medium" | "high";
  flags: string[];
}

type F = typeof fetch;
const cache = new Map<string, { at: number; v: Promise<unknown> }>();
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as Promise<T>;
  const v = fn();
  // sweep expired entries so one-off keys (every scanned address) don't accumulate forever
  if (cache.size > 2000)
    for (const [k, e] of cache)
      if (
        Date.now() - e.at > 6 * 3600_000 ||
        ((k.startsWith("money:") || k.startsWith("air:")) && Date.now() - e.at > 600_000)
      )
        cache.delete(k);
  cache.set(key, { at: Date.now(), v });
  // only drop our own entry: a newer scan for the same key may have replaced it meanwhile
  // a partial result (some source timed out) stays cached only briefly, so it is not served as complete
  v.then(
    (r) => {
      if (
        r &&
        typeof r === "object" &&
        (r as { partial?: unknown }).partial === true &&
        ttlMs > PARTIAL_TTL_MS
      ) {
        const t = setTimeout(() => {
          if (cache.get(key)?.v === v) cache.delete(key);
        }, PARTIAL_TTL_MS);
        (t as { unref?: () => void }).unref?.();
      }
    },
    () => {
      if (cache.get(key)?.v === v) cache.delete(key);
    },
  );
  return v;
}
/** How long a partial (timed-out) find_money / airdrop_check result stays cached. */
export const PARTIAL_TTL_MS = 20_000;
export const clearScannerCache = () => cache.clear();
/** True when a live (unexpired) entry exists for key. */
export const peekCached = (key: string, ttlMs: number) => {
  const hit = cache.get(key);
  return !!hit && Date.now() - hit.at < ttlMs;
};
/** Drop every entry whose key names this address (money:, bal:, air:, hist:...); other addresses are untouched. */
export function clearCachedFor(address: string) {
  const a = address.toLowerCase();
  if (a.length < 20) return 0;
  let n = 0;
  for (const k of cache.keys())
    if (k.toLowerCase().includes(a)) {
      cache.delete(k);
      n++;
    }
  return n;
}

async function json<T>(f: F, url: string, headers: Record<string, string> = {}): Promise<T> {
  const r = await f(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return (await r.json()) as T;
}
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const windows = (o: Record<string, unknown> | undefined): Partial<Record<Window, number>> => {
  const out: Partial<Record<Window, number>> = {};
  for (const w of ["m5", "h1", "h6", "h24"] as const) {
    const n = num(o?.[w]);
    if (n !== null) out[w] = n;
  }
  return out;
};

export function swapLink(chain: ScanChain, address: string): string {
  const id = SCAN_CHAINS[chain].chainId;
  const q = new URLSearchParams({
    fromChain: String(id),
    toChain: String(id),
    fromToken: nativeOf(id),
    toToken: address,
  });
  return `${SITE}/?${q}`;
}

/** Cheap heuristics for list rows (no per-token upstream call). token_risk does the deep check. */
export function quickRisk(t: Omit<ScanToken, "risk" | "swapUrl">, audit?: JupAudit): QuickRisk {
  const flags: string[] = [];
  let score = 0;
  if (t.liquidityUsd === null || t.liquidityUsd < 10_000) {
    flags.push("liquidity under $10k");
    score += 2;
  } else if (t.liquidityUsd < 50_000) {
    flags.push("thin liquidity");
    score += 1;
  }
  if (t.ageHours !== null && t.ageHours < 1) {
    flags.push("under 1 hour old");
    score += 2;
  } else if (t.ageHours !== null && t.ageHours < 24) {
    flags.push("under 24 hours old");
    score += 1;
  }
  if (t.fdvUsd && t.liquidityUsd && t.fdvUsd / t.liquidityUsd > 50) {
    flags.push("FDV over 50x liquidity");
    score += 1;
  }
  const h1 = t.priceChangePct.h1;
  if (h1 !== undefined && Math.abs(h1) > 200) {
    flags.push(`${h1 > 0 ? "+" : ""}${Math.round(h1)}% in 1h`);
    score += 1;
  }
  if (audit) {
    if (audit.mintAuthorityDisabled === false) {
      flags.push("mint authority enabled");
      score += 2;
    }
    if (audit.freezeAuthorityDisabled === false) {
      flags.push("freeze authority enabled");
      score += 3;
    }
    if ((audit.topHoldersPercentage ?? 0) > 50) {
      flags.push(`top holders own ${Math.round(audit.topHoldersPercentage ?? 0)}%`);
      score += 2;
    }
    if (audit.isSus) {
      flags.push("flagged suspicious by Jupiter");
      score += 3;
    }
  }
  return { level: score >= 4 ? "high" : score >= 2 ? "medium" : "low", flags };
}

interface JupAudit {
  mintAuthorityDisabled?: boolean;
  freezeAuthorityDisabled?: boolean;
  topHoldersPercentage?: number;
  isSus?: boolean;
}
interface JupToken {
  id: string;
  symbol?: string;
  name?: string;
  icon?: string;
  isVerified?: boolean;
  organicScoreLabel?: string;
  holderCount?: number;
  audit?: JupAudit;
  liquidity?: number;
  firstPool?: { createdAt?: string };
}
/** Jupiter token info for up to 100 mints (one call), cached 2 min per set. */
async function jupTokens(
  f: F,
  env: NodeJS.ProcessEnv,
  mints: string[],
): Promise<Map<string, JupToken>> {
  const out = new Map<string, JupToken>();
  const uniq = [...new Set(mints)].slice(0, 100);
  if (!uniq.length) return out;
  const headers: Record<string, string> = env.JUPITER_API_KEY
    ? { "x-api-key": env.JUPITER_API_KEY }
    : {};
  const list = await cached(`jup:${uniq.sort().join(",")}`, 120_000, () =>
    json<JupToken[]>(f, `https://api.jup.ag/tokens/v2/search?query=${uniq.join(",")}`, headers),
  ).catch(() => [] as JupToken[]);
  for (const t of list) out.set(t.id, t);
  return out;
}

interface DsPair {
  chainId: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
  boosts?: { active?: number };
}
const fromDsPair = (p: DsPair): Omit<ScanToken, "risk" | "swapUrl"> | null => {
  const chain = DS_TO_CHAIN[p.chainId];
  if (!chain) return null;
  const created = p.pairCreatedAt ? new Date(p.pairCreatedAt) : null;
  return {
    chain,
    chainId: SCAN_CHAINS[chain].chainId,
    address: p.baseToken.address,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    imageUrl: p.info?.imageUrl ?? null,
    priceUsd: num(p.priceUsd),
    liquidityUsd: num(p.liquidity?.usd),
    fdvUsd: num(p.fdv ?? p.marketCap),
    volumeUsd: windows(p.volume),
    priceChangePct: windows(p.priceChange),
    pairCreatedAt: created ? created.toISOString() : null,
    ageHours: created ? (Date.now() - created.getTime()) / 3.6e6 : null,
    dex: p.dexId ?? null,
    pairUrl: p.url ?? null,
    ...(p.boosts?.active ? { boosts: p.boosts.active } : {}),
  };
};
/** DexScreener pair data for token addresses (<=30 per call): deepest-liquidity pair per token. */
export async function dsTokens(f: F, chain: ScanChain, addrs: string[]) {
  const out: Omit<ScanToken, "risk" | "swapUrl">[] = [];
  const uniq = [...new Set(addrs)];
  for (let i = 0; i < uniq.length; i += 30) {
    const batch = uniq.slice(i, i + 30);
    const pairs = await cached(`ds:tok:${chain}:${batch.join(",")}`, 60_000, () =>
      json<DsPair[]>(
        f,
        `https://api.dexscreener.com/tokens/v1/${SCAN_CHAINS[chain].ds}/${batch.join(",")}`,
      ),
    ).catch(() => [] as DsPair[]);
    const best = new Map<string, DsPair>();
    for (const p of pairs) {
      const k = p.baseToken.address;
      if (!batch.includes(k)) continue;
      if ((p.liquidity?.usd ?? 0) >= (best.get(k)?.liquidity?.usd ?? -1)) best.set(k, p);
    }
    for (const p of best.values()) {
      const t = fromDsPair(p);
      if (t) out.push(t);
    }
  }
  return out;
}

interface GtPool {
  attributes: {
    name: string;
    pool_created_at?: string;
    reserve_in_usd?: string;
    fdv_usd?: string;
    market_cap_usd?: string | null;
    base_token_price_usd?: string;
    volume_usd?: Record<string, string>;
    price_change_percentage?: Record<string, string>;
    address?: string;
  };
  relationships: { base_token: { data: { id: string } }; dex?: { data: { id: string } } };
}
interface GtResp {
  data: GtPool[];
  included?: {
    id: string;
    attributes: { address: string; name: string; symbol: string; image_url?: string };
  }[];
}
async function gtPools(f: F, chain: ScanChain, kind: "new_pools" | "trending_pools") {
  const net = SCAN_CHAINS[chain].gt;
  const r = await cached(`gt:${kind}:${net}`, 60_000, () =>
    json<GtResp>(
      f,
      `https://api.geckoterminal.com/api/v2/networks/${net}/${kind}?include=base_token&page=1`,
    ),
  );
  const toks = new Map((r.included ?? []).map((t) => [t.id, t.attributes]));
  const out: Omit<ScanToken, "risk" | "swapUrl">[] = [];
  const seen = new Set<string>();
  for (const p of r.data) {
    const id = p.relationships.base_token.data.id;
    const t = toks.get(id);
    const address = t?.address ?? id.slice(id.indexOf("_") + 1);
    if (seen.has(address) || address === nativeOf(SCAN_CHAINS[chain].chainId)) continue;
    seen.add(address);
    const a = p.attributes;
    const created = a.pool_created_at ? new Date(a.pool_created_at) : null;
    out.push({
      chain,
      chainId: SCAN_CHAINS[chain].chainId,
      address,
      symbol: t?.symbol ?? a.name.split(" / ")[0] ?? "?",
      name: t?.name ?? a.name,
      imageUrl: t?.image_url && t.image_url !== "missing.png" ? t.image_url : null,
      priceUsd: num(a.base_token_price_usd),
      liquidityUsd: num(a.reserve_in_usd),
      fdvUsd: num(a.market_cap_usd ?? a.fdv_usd),
      volumeUsd: windows(a.volume_usd),
      priceChangePct: windows(a.price_change_percentage),
      pairCreatedAt: created ? created.toISOString() : null,
      ageHours: created ? (Date.now() - created.getTime()) / 3.6e6 : null,
      dex: p.relationships.dex?.data.id ?? null,
      pairUrl: a.address ? `https://www.geckoterminal.com/${net}/pools/${a.address}` : null,
    });
  }
  return out;
}

export const ScanQuery = z.object({
  chain: z
    .enum(["all", ...(Object.keys(SCAN_CHAINS) as [ScanChain, ...ScanChain[]])])
    .default("solana"),
  minLiquidityUsd: z.coerce.number().nonnegative().default(0),
  maxAgeHours: z.coerce.number().positive().optional(),
  minVolumeUsd: z.coerce.number().nonnegative().default(0),
  window: z.enum(["m5", "h1", "h6", "h24"]).default("h1"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ScanQuery = z.infer<typeof ScanQuery>;
type Kind = "new" | "trending" | "movers";

const chainsOf = (q: ScanQuery): ScanChain[] =>
  q.chain === "all" ? ["solana", "base", "bnb", "eth"] : [q.chain];

async function collect(f: F, kind: Kind, chains: ScanChain[]) {
  const rows: Omit<ScanToken, "risk" | "swapUrl">[] = [];
  const add = (xs: Omit<ScanToken, "risk" | "swapUrl">[]) => {
    rows.push(...xs);
  };
  const tasks: Promise<void>[] = [];
  for (const c of chains) {
    if (kind === "new" || kind === "movers")
      tasks.push(
        gtPools(f, c, "new_pools")
          .then(add)
          .catch(() => {}),
      );
    if (kind === "trending" || kind === "movers")
      tasks.push(
        gtPools(f, c, "trending_pools")
          .then(add)
          .catch(() => {}),
      );
  }
  // DexScreener: freshly profiled tokens (new) and paid boosts (trending), enriched with pair data.
  const ds = async (path: string, boosted: boolean) => {
    const list = await cached(`ds:${path}`, 60_000, () =>
      json<{ chainId: string; tokenAddress: string; totalAmount?: number; amount?: number }[]>(
        f,
        `https://api.dexscreener.com/${path}`,
      ),
    );
    for (const c of chains) {
      const mine = list.filter((x) => x.chainId === SCAN_CHAINS[c].ds).slice(0, 30);
      const got = await dsTokens(
        f,
        c,
        mine.map((x) => x.tokenAddress),
      );
      if (boosted)
        for (const g of got) {
          const b = mine.find((m) => m.tokenAddress === g.address);
          if (b) g.boosts = b.totalAmount ?? b.amount ?? g.boosts ?? 0;
        }
      add(got);
    }
  };
  if (kind === "new") tasks.push(ds("token-profiles/latest/v1", false).catch(() => {}));
  if (kind === "trending" || kind === "movers")
    tasks.push(ds("token-boosts/top/v1", true).catch(() => {}));
  await Promise.all(tasks);
  // Dedupe by chain+address, keep the row with most liquidity.
  const best = new Map<string, Omit<ScanToken, "risk" | "swapUrl">>();
  for (const r of rows) {
    const k = `${r.chain}:${r.address}`;
    const prev = best.get(k);
    if (!prev || (r.liquidityUsd ?? 0) > (prev.liquidityUsd ?? 0))
      best.set(k, { ...r, ...(prev?.boosts && !r.boosts ? { boosts: prev.boosts } : {}) });
  }
  return [...best.values()];
}

export async function scan(
  f: F,
  env: NodeJS.ProcessEnv,
  kind: Kind,
  q: ScanQuery,
): Promise<ScanToken[]> {
  const rows = (await collect(f, kind, chainsOf(q))).filter(
    (r) =>
      (r.liquidityUsd ?? 0) >= q.minLiquidityUsd &&
      (r.volumeUsd.h24 ?? r.volumeUsd[q.window] ?? 0) >= q.minVolumeUsd &&
      (q.maxAgeHours === undefined || (r.ageHours !== null && r.ageHours <= q.maxAgeHours)),
  );
  const sorted =
    kind === "new"
      ? rows.sort((a, b) => (a.ageHours ?? 1e9) - (b.ageHours ?? 1e9))
      : kind === "movers"
        ? rows
            .filter((r) => r.priceChangePct[q.window] !== undefined)
            .sort(
              (a, b) =>
                Math.abs(b.priceChangePct[q.window] ?? 0) -
                Math.abs(a.priceChangePct[q.window] ?? 0),
            )
        : rows.sort(
            (a, b) =>
              (b.boosts ?? 0) - (a.boosts ?? 0) || (b.volumeUsd.h24 ?? 0) - (a.volumeUsd.h24 ?? 0),
          );
  const top = sorted.slice(0, q.limit);
  const audits = await jupTokens(
    f,
    env,
    top.filter((t) => t.chain === "solana").map((t) => t.address),
  );
  return top.map((t) => {
    const j = t.chain === "solana" ? audits.get(t.address) : undefined;
    return {
      ...t,
      imageUrl: t.imageUrl ?? j?.icon ?? null,
      risk: quickRisk(t, j?.audit),
      swapUrl: swapLink(t.chain, t.address),
    };
  });
}

export interface TokenRisk {
  chain: ScanChain;
  address: string;
  level: "low" | "medium" | "high" | "unknown";
  flags: string[];
  checks: Record<string, unknown>;
  sources: string[];
  market: Omit<ScanToken, "risk" | "swapUrl"> | null;
  swapUrl: string;
  disclaimer: string;
}

/** Deep check: Solana = Jupiter audit + RugCheck; EVM = GoPlus token security. Plus market data. */
export async function tokenRisk(
  f: F,
  env: NodeJS.ProcessEnv,
  chain: ScanChain,
  address: string,
): Promise<TokenRisk> {
  const [market] = await dsTokens(f, chain, [address]);
  const flags: string[] = [];
  const checks: Record<string, unknown> = {};
  const sources: string[] = ["dexscreener"];
  let score = 0;
  let checked = false;
  if (chain === "solana") {
    const j = (await jupTokens(f, env, [address])).get(address);
    if (j) {
      checked = true;
      sources.push("jupiter");
      Object.assign(checks, {
        jupiterVerified: j.isVerified ?? false,
        organicScore: j.organicScoreLabel ?? null,
        holderCount: j.holderCount ?? null,
        mintAuthorityDisabled: j.audit?.mintAuthorityDisabled ?? null,
        freezeAuthorityDisabled: j.audit?.freezeAuthorityDisabled ?? null,
        topHoldersPct: j.audit?.topHoldersPercentage ?? null,
        firstPoolAt: j.firstPool?.createdAt ?? null,
      });
    }
    const rc = await cached(`rc:${address}`, 300_000, () =>
      json<{
        score_normalised?: number;
        lpLockedPct?: number;
        risks?: { name: string; level: string; description?: string }[];
      }>(f, `https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`),
    ).catch(() => null);
    if (rc) {
      checked = true;
      sources.push("rugcheck");
      checks.rugcheckScore = rc.score_normalised ?? null;
      checks.lpLockedPct = rc.lpLockedPct ?? null;
      for (const r of rc.risks ?? []) {
        flags.push(`${r.name}${r.level === "danger" ? " (danger)" : ""}`);
        score += r.level === "danger" ? 3 : 1;
      }
    }
    const q = market ? quickRisk(market, j?.audit) : quickRisk(blank(chain, address), j?.audit);
    for (const fl of q.flags) if (!flags.includes(fl)) flags.push(fl);
    score += q.level === "high" ? 4 : q.level === "medium" ? 2 : 0;
  } else {
    const gp = SCAN_CHAINS[chain].goplus;
    const r = gp
      ? await cached(`gp:${gp}:${address.toLowerCase()}`, 300_000, () =>
          json<{ result?: Record<string, Record<string, unknown>> }>(
            f,
            `https://api.gopluslabs.io/api/v1/token_security/${gp}?contract_addresses=${address}`,
          ),
        ).catch(() => null)
      : null;
    const g = r?.result?.[address.toLowerCase()];
    if (g) {
      checked = true;
      sources.push("goplus");
      const yes = (k: string) => g[k] === "1";
      const pct = (k: string) => (num(g[k]) ?? 0) * 100;
      Object.assign(checks, {
        honeypot: yes("is_honeypot"),
        buyTaxPct: pct("buy_tax"),
        sellTaxPct: pct("sell_tax"),
        mintable: yes("is_mintable"),
        openSource: yes("is_open_source"),
        proxy: yes("is_proxy"),
        ownerCanChangeBalance: yes("owner_change_balance"),
        holderCount: num(g.holder_count),
      });
      if (yes("is_honeypot")) flags.push("honeypot: cannot sell"), (score += 10);
      if (pct("sell_tax") > 10) flags.push(`sell tax ${pct("sell_tax").toFixed(0)}%`), (score += 3);
      if (pct("buy_tax") > 10) flags.push(`buy tax ${pct("buy_tax").toFixed(0)}%`), (score += 2);
      if (!yes("is_open_source")) flags.push("contract not verified"), (score += 2);
      if (yes("owner_change_balance")) flags.push("owner can change balances"), (score += 4);
      if (yes("is_mintable")) flags.push("mintable"), (score += 1);
      if (yes("is_proxy")) flags.push("upgradeable proxy"), (score += 1);
    }
    if (market) {
      const q = quickRisk(market);
      for (const fl of q.flags) if (!flags.includes(fl)) flags.push(fl);
      score += q.level === "high" ? 4 : q.level === "medium" ? 2 : 0;
    }
  }
  return {
    chain,
    address,
    level: !checked && !market ? "unknown" : score >= 5 ? "high" : score >= 2 ? "medium" : "low",
    flags,
    checks,
    sources,
    market: market ?? null,
    swapUrl: swapLink(chain, address),
    disclaimer: RISK_DISCLAIMER,
  };
}
const blank = (chain: ScanChain, address: string): Omit<ScanToken, "risk" | "swapUrl"> => ({
  chain,
  chainId: SCAN_CHAINS[chain].chainId,
  address,
  symbol: "?",
  name: "?",
  imageUrl: null,
  priceUsd: null,
  liquidityUsd: null,
  fdvUsd: null,
  volumeUsd: {},
  priceChangePct: {},
  pairCreatedAt: null,
  ageHours: null,
  dex: null,
  pairUrl: null,
});

export function scannerRoutes(f: F, env: NodeJS.ProcessEnv) {
  const app = new Hono();
  for (const kind of ["new", "trending", "movers"] as const)
    app.get(`/${kind}`, async (c) => {
      const q = ScanQuery.parse(c.req.query());
      const tokens = await scan(f, env, kind, q);
      c.header("cache-control", "public, max-age=30");
      return c.json({
        kind,
        query: q,
        tokens,
        updatedAt: new Date().toISOString(),
        disclaimer: RISK_DISCLAIMER,
      });
    });
  app.get("/risk", async (c) => {
    const q = z
      .object({
        chain: z.enum(Object.keys(SCAN_CHAINS) as [ScanChain, ...ScanChain[]]),
        address: z.string().min(32).max(64),
      })
      .parse(c.req.query());
    return c.json(await tokenRisk(f, env, q.chain, q.address));
  });
  return app;
}
