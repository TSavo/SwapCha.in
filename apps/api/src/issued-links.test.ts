// Fixture: wallet-bearing legacy targets are redacted (2026-10-24); those ids are expired.
// URLs are forever: every short id ever issued (any links.db backup, the live links.db, and the
// stray ids find_money once wrote into watches.db) must keep resolving.
// Fixture = snapshot of all of them; ids with two targets are the 2026-10-23 watches.db collision
// (100..103) where the links.db target, the one that was resolving, is kept.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  initLinksDb,
  isLegacyShortId,
  linkHoldsWalletData,
  migrateStrayLinks,
  resolveShort,
} from "./intel.js";
import issued from "./issued-links.fixture.json" with { type: "json" };

type Row = { url: string; created: number; source: string };
const all = issued as Record<string, Row[]>;
const kept = (rows: Row[]) => rows.find((r) => r.source !== "watches.db") ?? rows[0];

describe("every short id ever issued resolves", () => {
  it("replaying all backups through the migration resolves every id, never overwriting", () => {
    const links = new DatabaseSync(":memory:");
    initLinksDb(links);
    const stray = new DatabaseSync(":memory:");
    initLinksDb(stray);
    const ins = (d: DatabaseSync, id: string, r: Row, n: number) =>
      d
        .prepare("INSERT INTO links (n, id, url, created) VALUES (?, ?, ?, ?)")
        .run(n, id, r.url, r.created);
    let n = 0;
    for (const [id, rows] of Object.entries(all)) {
      n++;
      const k = kept(rows);
      if (k.source !== "watches.db") ins(links, id, k, n);
      for (const r of rows) if (r.source === "watches.db") ins(stray, id, r, n);
    }
    migrateStrayLinks(stray, links);
    // 2026-10-24: sequential ids that carry a wallet address / recovery calldata are expired
    // (they could be walked to list wallets with recoverable money); everything else still resolves.
    for (const [id, rows] of Object.entries(all)) {
      const url = kept(rows).url;
      const dead = isLegacyShortId(id) && linkHoldsWalletData(url);
      expect(resolveShort(links, id, false)?.url ?? null, `/s/${id}`).toBe(dead ? null : url);
    }
    const lost = links
      .prepare("SELECT id FROM link_collisions ORDER BY id")
      .all()
      .map((r) => (r as { id: string }).id);
    expect(lost).toEqual(
      Object.keys(all)
        .filter((id) => all[id].length > 1)
        .sort(),
    );
  });

  it.skipIf(!process.env.LIVE_LINKS)(
    "live: swapchan.com/s/<id> redirects to its target",
    async () => {
      for (const [id, rows] of Object.entries(all)) {
        const r = await fetch(`https://swapchan.com/s/${id}`, {
          method: "HEAD",
          redirect: "manual",
        });
        expect(r.status, `/s/${id}`).toBeGreaterThanOrEqual(300);
        expect(r.status, `/s/${id}`).toBeLessThan(400);
        expect(
          new URL(r.headers.get("location") ?? "", "https://swapchan.com").toString(),
          `/s/${id}`,
        ).toBe(
          isLegacyShortId(id) && linkHoldsWalletData(kept(rows).url)
            ? "https://swapchan.com/"
            : kept(rows).url,
        );
      }
    },
    120_000,
  );
});
