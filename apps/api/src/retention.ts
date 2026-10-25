import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Retention limits stated on swapchan.com/privacy. Keep the two in sync (legal.test.ts checks the web copy). */
export const DAY_MS = 86_400_000;
export const LINK_IDLE_MS = 365 * DAY_MS; // short link not clicked for 12 months
export const WATCH_MAX_AGE_MS = 365 * DAY_MS; // price watch 12 months after creation
export const PARTNER_SWAP_PII_MS = 730 * DAY_MS; // taker address + tx hash kept 24 months

/** Add last_click and the retired-id list to an existing links table (idempotent). */
export function migrateLinksRetention(db: DatabaseSync) {
  const cols = db.prepare("PRAGMA table_info(links)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "last_click"))
    db.exec("ALTER TABLE links ADD COLUMN last_click INTEGER");
  // Deleted ids are remembered (id only, no URL) so a short id is never reissued to a new target.
  db.exec(
    "CREATE TABLE IF NOT EXISTS links_retired (id TEXT PRIMARY KEY, retired INTEGER NOT NULL)",
  );
}

/** Delete short links whose last click (or creation, if never clicked) is older than 12 months. */
export function sweepLinks(db: DatabaseSync, now = Date.now()) {
  const cut = now - LINK_IDLE_MS;
  db.prepare(
    "INSERT OR IGNORE INTO links_retired (id, retired) SELECT id, ? FROM links WHERE id IS NOT NULL AND COALESCE(last_click, created) < ?",
  ).run(now, cut);
  const del = Number(
    db.prepare("DELETE FROM links WHERE COALESCE(last_click, created) < ?").run(cut).changes,
  );
  let col = 0;
  try {
    col = Number(db.prepare("DELETE FROM link_collisions WHERE recorded < ?").run(cut).changes);
  } catch {}
  return del + col;
}

/** Delete price watches created more than 12 months ago. */
export function sweepWatches(db: DatabaseSync, now = Date.now()) {
  return Number(
    db.prepare("DELETE FROM watches WHERE created_at < ?").run(now - WATCH_MAX_AGE_MS).changes,
  );
}

const redact = (tx: string) =>
  `redacted:${createHash("sha256").update(tx).digest("hex").slice(0, 32)}`;

/** After 24 months, drop the taker address and replace the tx hash with a one-way digest.
 *  Amounts, fees and counted flags stay, so partner earnings and payout totals don't change. */
export function sweepPartnerSwaps(db: DatabaseSync, now = Date.now()) {
  const cut = now - PARTNER_SWAP_PII_MS;
  const rows = db
    .prepare(
      "SELECT tx_hash FROM partner_swaps WHERE created_at < ? AND tx_hash NOT LIKE 'redacted:%'",
    )
    .all(cut) as { tx_hash: string }[];
  const up = db.prepare(
    "UPDATE OR IGNORE partner_swaps SET tx_hash = ?, taker = NULL WHERE tx_hash = ?",
  );
  let n = 0;
  for (const r of rows) n += Number(up.run(redact(r.tx_hash), r.tx_hash).changes);
  return n;
}

/** Run one sweep and log one JSON line: counts and timing only, never addresses, URLs or hashes. */
export function runSweep(
  name: string,
  kind: "removed" | "redacted",
  fn: () => number,
  log: (line: string) => void = console.log,
) {
  const t0 = Date.now();
  try {
    const n = fn();
    log(JSON.stringify({ evt: "retention_sweep", name, [kind]: n, ms: Date.now() - t0 }));
  } catch (e) {
    const error = e instanceof Error ? e.message : "unknown error";
    log(JSON.stringify({ evt: "retention_sweep_error", name, error: error.slice(0, 200) }));
  }
}

/** Run a sweep at startup and then daily (not under tests). */
export function scheduleSweep(
  env: NodeJS.ProcessEnv,
  name: string,
  kind: "removed" | "redacted",
  fn: () => number,
) {
  if (env.VITEST) return;
  const run = () => runSweep(name, kind, fn);
  run();
  setInterval(run, DAY_MS).unref();
}
