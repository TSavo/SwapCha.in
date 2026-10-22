import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Quote } from "@swapchan/shared";
import { Hono } from "hono";
import { isAddress } from "viem";
import { z } from "zod";

/**
 * Widget partners: sites that embed the SwapChan widget earn a share of our fee on swaps
 * attributed to their partner id. Fees can't be split on-chain for most providers, so
 * shares accrue here and are paid out manually from the fee wallet (payouts table).
 */
export interface PartnerStore {
  db: DatabaseSync;
  shareBps: number;
}

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ID = /^[a-z0-9-]{3,40}$/;

export function openPartnerStore(file: string, shareBps = 5000): PartnerStore {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY, token TEXT NOT NULL, name TEXT NOT NULL, site_url TEXT NOT NULL,
      evm_address TEXT NOT NULL, solana_address TEXT, share_bps INTEGER NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS partner_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, partner_id TEXT NOT NULL, quote_id TEXT NOT NULL,
      provider TEXT NOT NULL, volume_usd REAL, our_fee_usd REAL NOT NULL, fee_verified INTEGER NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS pq_partner ON partner_quotes(partner_id);
    CREATE TABLE IF NOT EXISTS partner_swaps (
      tx_hash TEXT PRIMARY KEY, partner_id TEXT NOT NULL, quote_id TEXT NOT NULL,
      provider TEXT NOT NULL, taker TEXT, from_chain INTEGER, to_chain INTEGER,
      volume_usd REAL, our_fee_usd REAL NOT NULL, fee_verified INTEGER NOT NULL,
      counted INTEGER NOT NULL, reason TEXT, partner_usd REAL NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ps_partner ON partner_swaps(partner_id);
    CREATE TABLE IF NOT EXISTS partner_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, partner_id TEXT NOT NULL, amount_usd REAL NOT NULL,
      tx_hash TEXT, note TEXT, created_at INTEGER NOT NULL);
  `);
  return { db, shareBps };
}

export const PartnerSignup = z.object({
  name: z.string().trim().min(2).max(80),
  siteUrl: z
    .string()
    .trim()
    .url()
    .max(200)
    .refine((u) => /^https?:\/\//i.test(u), "http(s) URL"),
  evmAddress: z.string().refine((a) => isAddress(a), "not an EVM address"),
  solanaAddress: z
    .string()
    .trim()
    .optional()
    .transform((s) => s || undefined)
    .refine((s) => s === undefined || SOL_ADDR.test(s), "not a Solana address"),
});

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "partner";

interface PartnerRow {
  id: string;
  token: string;
  name: string;
  site_url: string;
  evm_address: string;
  solana_address: string | null;
  share_bps: number;
  created_at: number;
}

export function getPartner(s: PartnerStore, id: string): PartnerRow | undefined {
  if (!ID.test(id)) return undefined;
  return s.db.prepare("SELECT * FROM partners WHERE id = ?").get(id) as PartnerRow | undefined;
}

export function registerPartner(
  s: PartnerStore,
  input: z.infer<typeof PartnerSignup>,
  now = Date.now(),
) {
  const id = `${slug(input.name)}-${randomBytes(3).toString("hex")}`;
  const token = randomBytes(18).toString("base64url");
  s.db
    .prepare(
      "INSERT INTO partners (id, token, name, site_url, evm_address, solana_address, share_bps, created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      token,
      input.name,
      input.siteUrl,
      input.evmAddress.toLowerCase(),
      input.solanaAddress ?? null,
      s.shareBps,
      now,
    );
  return { id, token, shareBps: s.shareBps };
}

const feeOf = (q: Quote) => (q.ourFeeVerified && (q.ourFeeUsd ?? 0) > 0 ? (q.ourFeeUsd ?? 0) : 0);

/** Record the best quote a partner's widget showed (funnel stats only; not paid). */
export function recordQuote(s: PartnerStore, partnerId: string, q: Quote, now = Date.now()) {
  s.db
    .prepare(
      "INSERT INTO partner_quotes (partner_id, quote_id, provider, volume_usd, our_fee_usd, fee_verified, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      partnerId,
      q.id,
      q.provider,
      q.netUsd ?? null,
      q.ourFeeUsd ?? 0,
      q.ourFeeVerified ? 1 : 0,
      now,
    );
}

/**
 * Record a submitted swap. Earns the partner a share only when our fee was verified by the
 * provider and the taker isn't the partner's own payout address (no self-referral).
 */
export function recordSwap(
  s: PartnerStore,
  p: PartnerRow,
  q: Quote,
  txHash: string,
  taker: string | undefined,
  now = Date.now(),
) {
  const fee = feeOf(q);
  const t = (taker ?? q.request.taker ?? "").toLowerCase();
  const own = [p.evm_address, p.solana_address?.toLowerCase()].filter(Boolean);
  const reason = !fee ? "no verified fee" : t && own.includes(t) ? "self-referral" : null;
  const counted = reason === null;
  const partnerUsd = counted ? (fee * p.share_bps) / 10_000 : 0;
  const r = s.db
    .prepare(
      `INSERT OR IGNORE INTO partner_swaps (tx_hash, partner_id, quote_id, provider, taker, from_chain, to_chain,
       volume_usd, our_fee_usd, fee_verified, counted, reason, partner_usd, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      txHash,
      p.id,
      q.id,
      q.provider,
      t || null,
      q.request.fromChainId,
      q.request.toChainId,
      q.netUsd ?? null,
      q.ourFeeUsd ?? 0,
      q.ourFeeVerified ? 1 : 0,
      counted ? 1 : 0,
      reason,
      partnerUsd,
      now,
    );
  return { recorded: Number(r.changes) > 0, counted, reason, partnerUsd };
}

export function partnerStats(s: PartnerStore, id: string) {
  const one = <T>(sql: string) => s.db.prepare(sql).get(id) as T;
  const q = one<{ n: number }>("SELECT COUNT(*) n FROM partner_quotes WHERE partner_id = ?");
  const sw = one<{ n: number; counted: number; vol: number; fees: number; earned: number }>(
    `SELECT COUNT(*) n, COALESCE(SUM(counted),0) counted, COALESCE(SUM(CASE WHEN counted=1 THEN volume_usd END),0) vol,
     COALESCE(SUM(CASE WHEN counted=1 THEN our_fee_usd END),0) fees, COALESCE(SUM(partner_usd),0) earned
     FROM partner_swaps WHERE partner_id = ?`,
  );
  const paid = one<{ v: number }>(
    "SELECT COALESCE(SUM(amount_usd),0) v FROM partner_payouts WHERE partner_id = ?",
  );
  const recent = s.db
    .prepare(
      "SELECT tx_hash txHash, provider, from_chain fromChainId, to_chain toChainId, volume_usd volumeUsd, our_fee_usd ourFeeUsd, counted, reason, partner_usd partnerUsd, created_at createdAt FROM partner_swaps WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(id);
  const payouts = s.db
    .prepare(
      "SELECT amount_usd amountUsd, tx_hash txHash, note, created_at createdAt FROM partner_payouts WHERE partner_id = ? ORDER BY created_at DESC",
    )
    .all(id);
  return {
    quotes: q.n,
    swaps: sw.n,
    countedSwaps: sw.counted,
    volumeUsd: sw.vol,
    feesUsd: sw.fees,
    earnedUsd: sw.earned,
    paidUsd: paid.v,
    owedUsd: Math.max(0, sw.earned - paid.v),
    recent,
    payouts,
  };
}

/** Per-IP signup throttle (in-memory): 5 per hour. */
function throttle(max = 5, windowMs = 3_600_000) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    return list.length <= max;
  };
}

export function partnerRoutes(
  s: PartnerStore,
  quoteCache: Map<string, Quote>,
  quotePartner: Map<string, string>,
) {
  const app = new Hono();
  const allow = throttle();
  app.post("/", async (c) => {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
    if (!allow(ip)) return c.json({ error: "too many signups, try again later" }, 429);
    const input = PartnerSignup.parse(await c.req.json());
    const r = registerPartner(s, input);
    return c.json(
      { ...r, dashboardUrl: `https://swapchan.com/partners/${r.id}?t=${r.token}` },
      201,
    );
  });
  // Public: does this partner id exist (the widget shows nothing about earnings).
  app.get("/:id/public", (c) => {
    const p = getPartner(s, c.req.param("id"));
    return p ? c.json({ id: p.id, name: p.name }) : c.json({ error: "unknown partner" }, 404);
  });
  // Private dashboard: needs the token from signup.
  app.get("/:id", (c) => {
    const p = getPartner(s, c.req.param("id"));
    if (!p || c.req.query("t") !== p.token)
      return c.json({ error: "unknown partner or bad link" }, 404);
    return c.json({
      partner: {
        id: p.id,
        name: p.name,
        siteUrl: p.site_url,
        evmAddress: p.evm_address,
        solanaAddress: p.solana_address,
        shareBps: p.share_bps,
        createdAt: p.created_at,
      },
      ...partnerStats(s, p.id),
    });
  });
  // The widget reports a submitted swap (tx hash) for a quote it got from /quotes?partner=.
  app.post("/:id/swaps", async (c) => {
    const p = getPartner(s, c.req.param("id"));
    if (!p) return c.json({ error: "unknown partner" }, 404);
    const b = z
      .object({
        quoteId: z.string().max(200),
        txHash: z.string().min(8).max(200),
        taker: z.string().max(100).optional(),
      })
      .parse(await c.req.json());
    const q = quoteCache.get(b.quoteId);
    if (!q || quotePartner.get(b.quoteId) !== p.id)
      return c.json({ error: "unknown or expired quote for this partner" }, 404);
    return c.json(recordSwap(s, p, q, b.txHash, b.taker));
  });
  return app;
}
