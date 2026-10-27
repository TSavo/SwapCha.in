import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_PAGE_ROWS } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { CHAIN_PAGES, chainHref, chainLd, chainPage } from "./chainPages";
import { DEV_TOOLS } from "./devTools";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("/chains pages", () => {
  it("one page per verified chain, unique slugs, none for unverified rows", () => {
    const verified = CHAIN_PAGE_ROWS.filter((r) => r.verified);
    expect(CHAIN_PAGES.length).toBe(verified.length);
    expect(new Set(CHAIN_PAGES.map((c) => c.slug)).size).toBe(CHAIN_PAGES.length);
    for (const r of CHAIN_PAGE_ROWS.filter((x) => !x.verified))
      expect(chainPage(r.slug)).toBeUndefined();
    expect(chainPage("bitcoin")?.name).toBe("btc");
  });
  it("each page has unique title, description, intro and real format facts", () => {
    for (const k of ["pageTitle", "description", "h1"] as const)
      expect(new Set(CHAIN_PAGES.map((c) => c[k])).size).toBe(CHAIN_PAGES.length);
    for (const c of CHAIN_PAGES) {
      expect(c.formats.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThan(170);
      expect(c.faq.length).toBeGreaterThanOrEqual(4);
      if (c.family === "utxo") expect(c.formats[0]?.detail).toContain(String(c.p2pkh?.[0]));
    }
  });
  it("never claims signing, sweeping or balances, and never asks for keys", () => {
    const text = JSON.stringify(CHAIN_PAGES.map(({ explorers: _e, ...c }) => c));
    expect(text).not.toMatch(/\bsweep|\bwe sign|build(s)? (a |an )?(unsigned )?transaction/i);
    expect(text).not.toMatch(/(paste|enter|type) (your )?(private key|seed)/i);
  });
  it("every page states its tier: address checking only, offline CLI only where chainTable says buildable", () => {
    for (const c of CHAIN_PAGES) {
      const tier = c.broadcast
        ? /^Address checking, plus relaying an already-signed transaction/
        : /^Address checking only/;
      expect(c.capability).toMatch(tier);
      expect(c.intro).toMatch(tier);
    }
    expect(chainPage("bitcoin")?.offlineCli).toBe(true);
    expect(chainPage("ethereum")?.offlineCli).toBe(false);
  });
  it("look-alikes share the version byte and link to existing pages", () => {
    const doge = chainPage("dogecoin")!;
    expect(doge.lookAlikes.map((l) => l.slug).sort()).toEqual(["digibyte", "pivx"]);
    for (const c of CHAIN_PAGES)
      for (const l of c.lookAlikes) expect(chainPage(l.slug)?.p2pkh).toEqual(c.p2pkh);
  });
  it("related links point at real tool pages", () => {
    const slugs = new Set(DEV_TOOLS.map((t) => t.slug));
    for (const c of CHAIN_PAGES) for (const r of c.related) expect(slugs.has(r)).toBe(true);
  });
  it("JSON-LD has app, FAQ and 3-level breadcrumbs, and never names the library", () => {
    for (const c of CHAIN_PAGES) {
      const ld = chainLd(c);
      expect(ld[2]?.itemListElement).toHaveLength(3);
      expect(JSON.stringify(ld)).not.toMatch(/blocktools/i);
    }
    expect(src("app/chains/page.tsx")).not.toMatch(/ld[^\n]*blocktools/i);
  });
  it("pages show the Powered by footer, canonical, and are in the sitemap and llms.txt", () => {
    for (const p of ["app/chains/[slug]/page.tsx", "app/chains/page.tsx"]) {
      expect(src(p)).toMatch(/<PoweredBy \/>/);
      expect(src(p)).toMatch(/canonical/);
    }
    const sm = src("app/sitemap.ts");
    expect(sm).toMatch(/page\("\/chains"/);
    expect(sm).toMatch(/CHAIN_PAGES\.map\(\(c\) => page\(chainHref\(c\)/);
    const llms = readFileSync(join(__dirname, "../../public/llms.txt"), "utf8");
    expect(llms).toContain("https://swapchan.com/chains");
    for (const t of DEV_TOOLS) expect(llms).toContain(`https://swapchan.com/tools/${t.slug}`);
    expect(chainHref(CHAIN_PAGES[0]!)).toMatch(/^\/chains\/[a-z0-9-]+$/);
  });
});
