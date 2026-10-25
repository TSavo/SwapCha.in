import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  initLinksDb,
  isLegacyShortId,
  linkHoldsWalletData,
  randomShortId,
  resolveShort,
  SHORT_ID_LEN,
  shorten,
} from "./intel.js";

const db = () => {
  const d = new DatabaseSync(":memory:");
  initLinksDb(d);
  return d;
};
const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const dec = (s: string) => [...s].reduce((n, c) => n * 62n + BigInt(B62.indexOf(c)), 0n);

describe("short ids are random, not sequential", () => {
  it("new ids are 12 base62 chars, unique, and not consecutive", () => {
    const d = db();
    const ids = Array.from(
      { length: 500 },
      (_, i) => shorten(d, `https://swapchan.com/?n=${i}`).id,
    );
    for (const id of ids) expect(id).toMatch(new RegExp(`^[0-9A-Za-z]{${SHORT_ID_LEN}}$`));
    expect(new Set(ids).size).toBe(ids.length);
    // consecutive issues are never neighbours (sequential ids would differ by 1)
    let near = 0;
    for (let i = 1; i < ids.length; i++) {
      const diff = dec(ids[i]!) - dec(ids[i - 1]!);
      if (diff > -1000n && diff < 1000n) near++;
    }
    expect(near).toBe(0);
    // ids are not ordered by issue time
    const sorted = [...ids].sort();
    expect(sorted).not.toEqual(ids);
  });
  it("character distribution looks uniform (crypto RNG, no modulo bias)", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++)
      for (const c of randomShortId()) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(62);
    const exp = (2000 * SHORT_ID_LEN) / 62;
    for (const n of counts.values()) expect(Math.abs(n - exp) / exp).toBeLessThan(0.35);
  });
  it("guessing sequential legacy-style ids finds nothing", () => {
    const d = db();
    for (let i = 0; i < 50; i++) shorten(d, `https://swapchan.com/?n=${i}`);
    for (let n = 0; n < 5000; n++) {
      let s = "",
        k = n + 3843;
      do {
        s = B62[k % 62] + s;
        k = Math.floor(k / 62);
      } while (k > 0);
      expect(resolveShort(d, s, false)).toBeNull();
    }
  });
});

describe("legacy sequential ids", () => {
  const legacy = (d: DatabaseSync, id: string, url: string) =>
    d.prepare("INSERT INTO links (id, url, created) VALUES (?, ?, ?)").run(id, url, Date.now());
  const REC =
    "https://swapchan.com/recover?chain=1&to=0x3333333333333333333333333333333333333333&data=0xabcdef&title=x";
  it("classifies wallet-bearing URLs", () => {
    expect(isLegacyShortId("1a2")).toBe(true);
    expect(isLegacyShortId(randomShortId())).toBe(false);
    expect(linkHoldsWalletData(REC)).toBe(true);
    expect(
      linkHoldsWalletData(
        "https://swapchan.com/?fromChain=1&toChain=1&fromToken=a&toToken=b&recipient=x",
      ),
    ).toBe(true);
    expect(
      linkHoldsWalletData(
        "https://swapchan.com/?fromChain=1&toChain=1&fromToken=a&toToken=b&amount=1",
      ),
    ).toBe(false);
  });
  it("legacy ids holding recovery data stop resolving; plain swap links keep resolving", () => {
    const d = db();
    legacy(d, "1a2", REC);
    legacy(d, "1a3", "https://swapchan.com/?fromChain=1&amount=1");
    expect(resolveShort(d, "1a2", false)).toBeNull();
    expect(resolveShort(d, "1a3", false)?.url).toBe("https://swapchan.com/?fromChain=1&amount=1");
  });
  it("re-shortening a retired recovery URL issues a fresh random id; old id stays dead", () => {
    const d = db();
    legacy(d, "1a2", REC);
    const s = shorten(d, REC);
    expect(s.id).toHaveLength(SHORT_ID_LEN);
    expect(resolveShort(d, s.id, false)?.url).toBe(REC);
    expect(resolveShort(d, "1a2", false)).toBeNull();
    expect(shorten(d, REC).id).toBe(s.id);
  });
});
