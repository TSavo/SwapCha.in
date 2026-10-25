import { describe, expect, it } from "vitest";
import { buildInput, CHAIN_COUNT, DEV_TOOLS, devToolLd, looksSecret, POWERED_BY } from "./devTools";

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
    expect(CHAIN_COUNT).toBe(41);
    expect(POWERED_BY).toBe("This tool is powered by blocktools.");
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
