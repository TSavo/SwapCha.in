import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  buildSwapLink,
  initLinksDb,
  linkRoutes,
  resolveShort,
  shorten,
  verifyClaimTx,
} from "./intel.js";

const db = () => {
  const d = new DatabaseSync(":memory:");
  initLinksDb(d);
  return d;
};
const noFetch = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;

describe("short links", () => {
  it("dedupes, never reuses, counts clicks", () => {
    const d = db();
    const a = shorten(d, "https://swapchan.com/?fromChain=1&amount=1");
    const b = shorten(d, "https://swapchan.com/?fromChain=1&amount=1");
    const c = shorten(d, "https://swapchan.com/?fromChain=1&amount=2");
    expect(a.id).toBe(b.id);
    expect(c.id).not.toBe(a.id);
    expect(a.shortUrl).toBe(`https://swapchan.com/s/${a.id}`);
    expect(resolveShort(d, a.id)?.clicks).toBe(1);
    expect(resolveShort(d, a.id)?.clicks).toBe(2);
    expect(resolveShort(d, "nope")).toBeNull();
  });
  it("rejects non-swapchan destinations (no open redirect)", () => {
    const d = db();
    expect(() => shorten(d, "https://evil.com/")).toThrow();
    expect(() => shorten(d, "http://swapchan.com/")).toThrow();
    expect(() => shorten(d, "https://swapchan.com.evil.com/")).toThrow();
  });
  it("builds a swap link from chain names and symbols", async () => {
    const r = await buildSwapLink(noFetch, {}, db(), {
      fromChain: "base",
      fromToken: "ETH",
      toChain: "arbitrum",
      toToken: "USDC",
      amount: "0.1",
      ref: "p1",
    });
    expect(r.fromChainId).toBe(8453);
    expect(r.toChainId).toBe(42161);
    expect(r.url).toContain("toToken=0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(r.url).toContain("ref=p1");
    expect(r.shortUrl).toMatch(/^https:\/\/swapchan\.com\/s\/[0-9a-zA-Z]+$/);
  });
  it("REST: POST /links and GET /links/:id", async () => {
    const app = linkRoutes(noFetch, { VITEST: "1" }, new DatabaseSync(":memory:"));
    const r = await app.request("/", {
      method: "POST",
      body: JSON.stringify({ url: "https://swapchan.com/?ref=x" }),
      headers: { "content-type": "application/json" },
    });
    const j = (await r.json()) as { id: string };
    const g = (await (await app.request(`/${j.id}`)).json()) as { url: string };
    expect(g.url).toBe("https://swapchan.com/?ref=x");
    expect(
      (await app.request("/", { method: "POST", body: JSON.stringify({ url: "https://x.com" }) }))
        .status,
    ).toBe(400);
  });
});

describe("claim allowlist", () => {
  it("allows only exact claim calls", () => {
    const P3D = "0xB3775fB83F7D12A36E0475aBdD1FCA35c091efBe";
    expect(verifyClaimTx({ to: P3D, data: "0xe9fad8ee", value: "0" }).verified).toBe(true);
    expect(verifyClaimTx({ to: P3D, data: "0xe9fad8ee", value: "1" }).verified).toBe(false);
    expect(verifyClaimTx({ to: P3D, data: "0xa9059cbb", value: "0" }).verified).toBe(false);
    expect(
      verifyClaimTx({
        to: "0x0000000000000000000000000000000000000001",
        data: "0xe9fad8ee",
        value: "0",
      }).verified,
    ).toBe(false);
  });
});

describe("stray short links migrate", () => {
  it("keeps ids, never reissues one, existing ids win", async () => {
    const { migrateStrayLinks } = await import("./intel.js");
    const a = db(), b = db();
    shorten(a, "https://swapchan.com/?a=1"); // n=1 in links.db
    shorten(b, "https://swapchan.com/?b=1"); // n=1 collides
    const s2 = shorten(b, "https://swapchan.com/?b=2"); // n=2
    expect(migrateStrayLinks(b, a)).toBe(1);
    expect(resolveShort(a, s2.id)?.url).toBe("https://swapchan.com/?b=2");
    const next = shorten(a, "https://swapchan.com/?new");
    expect([s2.id]).not.toContain(next.id);
  });
});
