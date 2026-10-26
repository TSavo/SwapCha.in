import { describe, expect, it } from "vitest";
import {
  BLOCKTOOLS_URL,
  buildInput,
  CHAIN_COUNT,
  DEV_TOOLS,
  devToolLd,
  looksSecret,
  POWERED_BY,
  RELATED_FOR,
  relatedTools,
  UTXO_CHAIN_COUNT,
} from "./devTools";

describe("developer tool pages", () => {
  it("every page has SEO copy, 3-5 FAQs, examples and valid related links", () => {
    const slugs = new Set(DEV_TOOLS.map((t) => t.slug));
    expect(slugs.size).toBe(DEV_TOOLS.length);
    for (const t of DEV_TOOLS) {
      expect(t.title).toMatch(/\| SwapChan$/);
      expect(t.title.length).toBeLessThanOrEqual(90);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.faq.length).toBeGreaterThanOrEqual(3);
      expect(t.faq.length).toBeLessThanOrEqual(5);
      expect(t.examples.length).toBeGreaterThan(0);
      for (const e of t.examples) expect(t.modes.some((m) => m.id === e.mode)).toBe(true);
      for (const r of t.related) expect(slugs.has(r)).toBe(true);
    }
    expect(CHAIN_COUNT).toBe(47);
    expect(UTXO_CHAIN_COUNT).toBe(34);
    expect(POWERED_BY).toBe("Powered by blocktools");
    expect(BLOCKTOOLS_URL).toBe("https://github.com/TSavo/blocktools");
  });

  it("JSON-LD: free DeveloperApplication, FAQPage matching visible FAQ, breadcrumb", () => {
    for (const t of DEV_TOOLS) {
      const [app, faq, crumbs] = devToolLd(t);
      expect(app).toMatchObject({
        "@type": "SoftwareApplication",
        applicationCategory: "DeveloperApplication",
        offers: { price: "0" },
      });
      expect((faq as { mainEntity: { name: string }[] }).mainEntity.map((q) => q.name)).toEqual(
        t.faq.map((f) => f.q),
      );
      expect(crumbs).toMatchObject({ "@type": "BreadcrumbList" });
      expect(JSON.stringify([app, faq, crumbs])).not.toMatch(/blocktools/i);
    }
  });

  it("builds typed request bodies and spots secrets before sending", () => {
    const ss = DEV_TOOLS.find((t) => t.slug === "ss58")!.modes[0]!;
    expect(buildInput(ss, { address: " 5Grw ", prefix: "2", junk: "x" })).toEqual({
      op: "convert",
      address: "5Grw",
      prefix: 2,
    });
    const pda = DEV_TOOLS.find((t) => t.slug === "solana-pda")!.modes.find((m) => m.id === "pda")!;
    expect(buildInput(pda, { program: "P", seeds: "aa\nbb" })).toEqual({
      program: "P",
      seeds: ["aa", "bb"],
    });
    expect(looksSecret({ xpub: `xprv${"A".repeat(107)}` })).toBe(true);
    expect(looksSecret({ x: Array(12).fill("abandon").join(" ") })).toBe(true);
    expect(looksSecret({ xpub: `xpub${"A".repeat(107)}` })).toBe(false);
  });
});

describe("new tool pages and result-page links", () => {
  it("address-script, hash-tools, polkadot-storage-key, anchor-discriminator exist with keywords and MCP tools", () => {
    const want: Record<string, string> = {
      "address-script": "address_tool",
      "hash-tools": "hash_tool",
      "polkadot-storage-key": "substrate_tool",
      "anchor-discriminator": "solana_address",
    };
    for (const [slug, mcp] of Object.entries(want)) {
      const t = DEV_TOOLS.find((x) => x.slug === slug)!;
      expect(t.mcp).toBe(mcp);
      expect(t.keywords.length).toBeGreaterThan(0);
      expect(JSON.stringify(t)).not.toMatch(/blocktools/i);
    }
  });
  it("find_money, wallet and recover link only to real /tools pages", () => {
    for (const ctx of Object.keys(RELATED_FOR) as (keyof typeof RELATED_FOR)[]) {
      const l = relatedTools(ctx);
      expect(l.length).toBe(RELATED_FOR[ctx].length);
      for (const x of l) expect(x.href).toMatch(/^\/tools\/[a-z0-9-]+$/);
    }
  });
});

describe("tron-tx, supported-chains and cashaddr encode pages", () => {
  it("exist, map to their MCP tools and send only declared fields", () => {
    const tron = DEV_TOOLS.find((t) => t.slug === "tron-tx")!;
    expect(tron.mcp).toBe("tron_tx");
    expect(buildInput(tron.modes.find((m) => m.id === "txid")!, { hex: " 0a02 ", x: "y" })).toEqual(
      {
        op: "txid",
        hex: "0a02",
      },
    );
    expect(DEV_TOOLS.find((t) => t.slug === "supported-chains")!.mcp).toBe("supported_chains");
    const enc = DEV_TOOLS.find((t) => t.slug === "cashaddr")!.modes.find((m) => m.id === "encode")!;
    expect(buildInput(enc, { kind: "p2pkh", hash: "ab", prefix: "" })).toEqual({
      op: "encode",
      kind: "p2pkh",
      hash: "ab",
    });
    for (const s of ["tron-tx", "supported-chains"])
      expect(JSON.stringify(DEV_TOOLS.find((t) => t.slug === s))).not.toMatch(/blocktools/i);
  });
});

describe("Powered by blocktools footer", () => {
  it("is a link to the public repo (noopener) on every tool page and the /tools hub", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
    const pb = src("components/devtools/PoweredBy.tsx");
    expect(pb).toMatch(/<a\s+href=\{BLOCKTOOLS_URL\}/);
    expect(pb).toMatch(/rel="noopener noreferrer"/);
    expect(pb).toMatch(/\{POWERED_BY\}/);
    for (const p of ["components/devtools/DevToolPage.tsx", "app/tools/page.tsx"]) {
      expect(src(p)).toMatch(/<PoweredBy \/>/);
      expect(src(p)).not.toMatch(/\{POWERED_BY\}/);
    }
  });
});
