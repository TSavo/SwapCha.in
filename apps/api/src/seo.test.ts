import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import { clearScannerCache } from "./scanner.js";
import { keyFor, listSeo, MIN_INDEX_LIQ, openSeoStore, refreshSeo, symSlug } from "./seo.js";

const MINT = "Mint1111111111111111111111111111111111111111";
const BASE_TOK = "0x1234567890abcdef1234567890abcdef12345678";
const RUG = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";

function pool(net: string, addr: string, sym: string, liq: number) {
  return {
    data: [
      {
        attributes: {
          name: `${sym} / X`,
          pool_created_at: new Date(Date.now() - 30 * 864e5).toISOString(),
          reserve_in_usd: String(liq),
          fdv_usd: String(liq * 10),
          base_token_price_usd: "0.5",
          volume_usd: { h24: "900000", h1: "40000" },
          price_change_percentage: { h24: "12", h1: "1" },
        },
        relationships: {
          base_token: { data: { id: `${net}_${addr}` } },
          dex: { data: { id: "dex" } },
        },
      },
    ],
    included: [
      { id: `${net}_${addr}`, attributes: { address: addr, name: `${sym} Token`, symbol: sym } },
    ],
  };
}

function mockFetch(liq: { value: number }) {
  return (async (input: RequestInfo | URL) => {
    const u = String(input);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes("geckoterminal") && u.includes("/solana/trending_pools"))
      return ok(pool("solana", MINT, "WIF", 500_000));
    if (u.includes("geckoterminal") && u.includes("/base/trending_pools")) {
      const p = pool("base", BASE_TOK, "WIF", 400_000);
      const r = pool("base", RUG, "RUG", 400_000);
      p.data.push(...r.data);
      p.included.push(...r.included);
      return ok(p);
    }
    if (u.includes("geckoterminal")) return ok({ data: [], included: [] });
    if (u.includes("dexscreener.com/tokens/v1/")) {
      const [, chain, addrs] = u.match(/tokens\/v1\/([^/]+)\/(.+)$/) ?? [];
      return ok(
        (addrs ?? "").split(",").map((a) => ({
          chainId: chain,
          baseToken: { address: a, name: "x", symbol: "X" },
          priceUsd: "0.5",
          liquidity: { usd: liq.value },
          volume: { h24: 1000 },
          priceChange: {},
        })),
      );
    }
    if (u.includes("dexscreener")) return ok([]);
    if (u.includes("rugcheck")) return ok({ score_normalised: 1, risks: [] });
    if (u.includes("gopluslabs")) {
      const a = (u.split("contract_addresses=")[1] ?? "").toLowerCase();
      return ok({ result: { [a]: { is_open_source: "1", is_honeypot: a === RUG ? "1" : "0" } } });
    }
    if (u.includes("jup.ag")) return ok([]);
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
}

describe("seo trending pages", () => {
  it("slugs symbols safely", () => {
    expect(symSlug("$WIF")).toBe("wif");
    expect(symSlug("Moo Deng")).toBe("moo-deng");
    expect(symSlug("🐸")).toBeNull();
  });

  it("creates pages, disambiguates collisions, skips risky tokens, persists and goes noindex", async () => {
    clearScannerCache();
    const db = openSeoStore(":memory:");
    const liq = { value: 300_000 };
    const r = await refreshSeo(db, mockFetch(liq), {}, { gapMs: 0, now: 1000 });
    const keys = listSeo(db)
      .map((t) => t.key)
      .sort();
    expect(keys).toEqual(["wif", `wif-base-${BASE_TOK.slice(2, 8)}`].sort());
    expect(r.skippedRisk).toBeGreaterThan(0); // honeypot RUG
    expect(keyFor(db, "solana", "other", "WIF")).toBe("wif-solana-other");

    // Trend fades and liquidity collapses: pages stay, flip to noindex.
    clearScannerCache();
    liq.value = MIN_INDEX_LIQ - 1;
    const empty = (async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("geckoterminal"))
        return new Response(JSON.stringify({ data: [], included: [] }));
      return mockFetch(liq)(i);
    }) as typeof fetch;
    await refreshSeo(db, empty, {}, { gapMs: 0, now: 2000 });
    const after = listSeo(db);
    expect(after).toHaveLength(2);
    expect(after.every((t) => !t.indexable)).toBe(true);

    const app = createApp([], {
      seo: db,
      scannerFetch: empty,
      partners: null,
      simulator: null,
      pricer: null,
    });
    const list = await (await app.request("/seo/tokens")).json();
    expect(list.tokens).toHaveLength(2);
    const one = await app.request("/seo/tokens/wif");
    expect(one.status).toBe(200);
    const body = await one.json();
    expect(body.token.address).toBe(MINT);
    expect(body.market.liquidityUsd).toBe(MIN_INDEX_LIQ - 1);
    expect((await app.request("/seo/tokens/nope")).status).toBe(404);
  });
});
