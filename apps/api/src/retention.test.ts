import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { initLinksDb, resolveShort, shorten } from "./intel.js";
import { openWatchDb } from "./onchain.js";
import { openPartnerStore } from "./partners.js";
import { DAY_MS, runSweep, sweepLinks, sweepPartnerSwaps, sweepWatches } from "./retention.js";

const NOW = Date.UTC(2027, 0, 1);
const ago = (d: number) => NOW - d * DAY_MS;

describe("short link retention", () => {
  it("deletes links idle 12 months, keeps recent or recently clicked ones, never reissues ids", () => {
    const db = new DatabaseSync(":memory:");
    initLinksDb(db);
    const ins = db.prepare(
      "INSERT INTO links (id, url, created, clicks, last_click) VALUES (?, ?, ?, ?, ?)",
    );
    ins.run("old", "https://swapchan.com/a", ago(400), 0, null);
    ins.run("oldclicked", "https://swapchan.com/b", ago(400), 3, ago(400));
    ins.run("revived", "https://swapchan.com/c", ago(800), 9, ago(10));
    ins.run("fresh", "https://swapchan.com/d", ago(5), 0, null);
    expect(sweepLinks(db, NOW)).toBe(2);
    const left = (db.prepare("SELECT id FROM links ORDER BY id").all() as { id: string }[]).map(
      (r) => r.id,
    );
    expect(left).toEqual(["fresh", "revived"]);
    expect(resolveShort(db, "old")).toBeNull();
    expect(db.prepare("SELECT 1 FROM links_retired WHERE id='old'").get()).toBeTruthy();
  });
  it("a click refreshes last_click", () => {
    const db = new DatabaseSync(":memory:");
    initLinksDb(db);
    const { id } = shorten(db, "https://swapchan.com/swap");
    db.prepare("UPDATE links SET created = ?, last_click = NULL").run(ago(500));
    resolveShort(db, id);
    expect(sweepLinks(db, Date.now())).toBe(0);
    expect(resolveShort(db, id, false)?.url).toBe("https://swapchan.com/swap");
  });
  it("migrates an old links table without last_click", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE links (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, url TEXT UNIQUE NOT NULL, created INTEGER NOT NULL, clicks INTEGER NOT NULL DEFAULT 0)",
    );
    db.prepare(
      "INSERT INTO links (id, url, created) VALUES ('x', 'https://swapchan.com/x', ?)",
    ).run(ago(1));
    initLinksDb(db);
    expect(sweepLinks(db, NOW)).toBe(0);
  });
});

describe("watch retention", () => {
  it("deletes watches created over 12 months ago only", () => {
    const db = openWatchDb(":memory:");
    const ins = db.prepare(
      "INSERT INTO watches (watch_id, item_id, chain_id, address, created_at) VALUES (?, ?, 1, '0xabc', ?)",
    );
    ins.run("w1", "a", ago(366));
    ins.run("w2", "a", ago(364));
    expect(sweepWatches(db, NOW)).toBe(1);
    expect(
      (db.prepare("SELECT watch_id FROM watches").all() as { watch_id: string }[]).map(
        (r) => r.watch_id,
      ),
    ).toEqual(["w2"]);
  });
});

describe("partner swap retention", () => {
  it("redacts taker and tx hash after 24 months, keeping amounts", () => {
    const { db } = openPartnerStore(":memory:");
    const ins = db.prepare(
      "INSERT INTO partner_swaps (tx_hash, partner_id, quote_id, provider, taker, volume_usd, our_fee_usd, fee_verified, counted, partner_usd, created_at) VALUES (?, 'p', 'q', 'lifi', '0xtaker', 1000, 1, 1, 1, 0.5, ?)",
    );
    ins.run("0xold", ago(731));
    ins.run("0xnew", ago(729));
    expect(sweepPartnerSwaps(db, NOW)).toBe(1);
    expect(sweepPartnerSwaps(db, NOW)).toBe(0);
    const rows = db
      .prepare("SELECT tx_hash, taker, partner_usd FROM partner_swaps ORDER BY created_at")
      .all() as {
      tx_hash: string;
      taker: string | null;
      partner_usd: number;
    }[];
    expect(rows[0]?.tx_hash).toMatch(/^redacted:[0-9a-f]{32}$/);
    expect(rows[0]?.taker).toBeNull();
    expect(rows[0]?.partner_usd).toBe(0.5);
    expect(rows[1]).toEqual({ tx_hash: "0xnew", taker: "0xtaker", partner_usd: 0.5 });
  });
});

describe("sweep logging", () => {
  it("logs one count/timing line on success and a message-only line on failure", () => {
    const lines: string[] = [];
    runSweep(
      "links",
      "removed",
      () => 3,
      (l) => lines.push(l),
    );
    runSweep(
      "partner_swaps",
      "redacted",
      () => {
        throw new Error("database is locked");
      },
      (l) => lines.push(l),
    );
    const [ok, bad] = lines.map((l) => JSON.parse(l));
    expect(ok).toMatchObject({ evt: "retention_sweep", name: "links", removed: 3 });
    expect(typeof ok.ms).toBe("number");
    expect(Object.keys(ok).sort()).toEqual(["evt", "ms", "name", "removed"]);
    expect(bad).toEqual({
      evt: "retention_sweep_error",
      name: "partner_swaps",
      error: "database is locked",
    });
  });
  it("never logs link URLs or addresses from a real sweep", () => {
    const db = new DatabaseSync(":memory:");
    initLinksDb(db);
    db.prepare(
      "INSERT INTO links (id, url, created) VALUES ('x', 'https://swapchan.com/wallet/0xabc', ?)",
    ).run(ago(400));
    const lines: string[] = [];
    runSweep(
      "links",
      "removed",
      () => sweepLinks(db, NOW),
      (l) => lines.push(l),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/0xabc|swapchan\.com|"x"/);
    expect(JSON.parse(lines[0] ?? "{}").removed).toBe(1);
  });
});
