import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fx from "./fixtures/nvc-gettransaction.json" with { type: "json" };
import {
  fetchPrevTxs,
  POOL_BY_TYPE,
  PREV_LIMITS,
  resetPrevTxCache,
  retryAfterMs,
  txidOfRaw,
} from "./prevtx.js";

// A real local HTTP server standing in for api.novaco.in, serving the saved /gettransaction answers but throttling
// on a per-test policy (503/429, optional Retry-After). Exercises the real fetch + retry path end to end.
const txs = fx.txs as { txid: string; body: string }[];
const by = new Map(txs.map((t) => [t.txid, t.body]));
const ids = txs.map((t) => t.txid);
type Policy = (
  txid: string,
  nth: number,
) => { status: number; headers?: Record<string, string> } | null;
let policy: Policy = () => null;
let hits: { txid: string; at: number }[] = [];
let live = 0;
let maxLive = 0;
let server: Server;
let base = "";
const saved = { ...PREV_LIMITS };

beforeAll(async () => {
  server = createServer((req, res) => {
    live++;
    maxLive = Math.max(maxLive, live);
    const t = /\/gettransaction\/([0-9a-f]{64})$/.exec(req.url ?? "")?.[1] ?? "";
    const nth = hits.filter((h) => h.txid === t).length;
    hits.push({ txid: t, at: Date.now() });
    setTimeout(() => {
      live--;
      const p = policy(t, nth);
      if (p) {
        res.writeHead(p.status, p.headers ?? {});
        return res.end("busy");
      }
      if (!by.has(t)) {
        res.writeHead(404);
        return res.end();
      }
      res.end(by.get(t));
    }, 20);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  resetPrevTxCache();
  hits = [];
  live = maxLive = 0;
  policy = () => null;
  Object.assign(PREV_LIMITS, { backoffBaseMs: 50, backoffMaxMs: 400 });
});
afterEach(() => Object.assign(PREV_LIMITS, saved));
const src = (extra: object = {}) => ({ type: "novacoin" as const, urls: [base], ...extra });

describe("prev-tx fetch against a throttling explorer", () => {
  it("novacoin defaults to a 3-wide pool", () => {
    expect(POOL_BY_TYPE.novacoin).toBe(3);
  });
  it("retries 503s with backoff and gets every tx (hash-checked)", async () => {
    policy = (_t, nth) => (nth < 2 ? { status: 503 } : null);
    const { got, failed } = await fetchPrevTxs(fetch, "nvc", src(), ids);
    expect(failed.size).toBe(0);
    expect(got.size).toBe(3);
    for (const [t, hex] of got) expect(txidOfRaw(hex)).toBe(t);
    expect(hits.length).toBe(9);
  });
  it("retries 429 too", async () => {
    policy = (_t, nth) => (nth < 1 ? { status: 429 } : null);
    const { got } = await fetchPrevTxs(fetch, "nvc", src(), ids);
    expect(got.size).toBe(3);
  });
  it("honors Retry-After (seconds) as a floor for the next attempt", async () => {
    policy = (_t, nth) => (nth < 1 ? { status: 503, headers: { "retry-after": "1" } } : null);
    const { got } = await fetchPrevTxs(fetch, "nvc", src({ pool: 1 }), [ids[0]!]);
    expect(got.size).toBe(1);
    expect(hits[1]!.at - hits[0]!.at).toBeGreaterThanOrEqual(950);
  });
  it("respects the per-source pool", async () => {
    await fetchPrevTxs(fetch, "nvc", src({ pool: 1 }), ids);
    expect(maxLive).toBe(1);
  });
  it("fails closed within the overall deadline when the explorer keeps answering 503", async () => {
    Object.assign(PREV_LIMITS, { deadlineMs: 1500, retries: 50 });
    policy = () => ({ status: 503 });
    const t0 = Date.now();
    const { got, failed } = await fetchPrevTxs(fetch, "nvc", src(), ids);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(got.size).toBe(0);
    expect(failed.size).toBe(3);
    for (const why of failed.values()) expect(why).toMatch(/503|throttl|deadline|abort|timeout/);
  });
  it("does not retry other errors (404 once per tx)", async () => {
    const missing = "00".repeat(32);
    const { failed } = await fetchPrevTxs(fetch, "nvc", src(), [missing]);
    expect(failed.get(missing)).toBe("HTTP 404");
    expect(hits.length).toBe(1);
  });
  it("caches successful txs: a second call makes no requests", async () => {
    policy = (_t, nth) => (nth < 1 ? { status: 503 } : null);
    await fetchPrevTxs(fetch, "nvc", src(), ids);
    const n = hits.length;
    const { got } = await fetchPrevTxs(fetch, "nvc", src(), ids);
    expect(got.size).toBe(3);
    expect(hits.length).toBe(n);
  });
  it("parses Retry-After", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4000)).toBe(6000);
  });
});
