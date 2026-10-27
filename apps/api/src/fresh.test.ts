import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRESH_GLOBAL_MAX,
  FRESH_PER_IP_MAX,
  freshGate,
  moneyWithFreshness,
  resetFreshLimits,
} from "./fresh.js";
import { cached, clearCachedFor, clearScannerCache, peekCached } from "./scanner.js";

const A = "0x000000000000000000000000000000000000dEaD";
const B = "0x1111111111111111111111111111111111111111";
const call = (scan: () => Promise<{ n: number }>, fresh = false, addr = A) =>
  moneyWithFreshness(`money:${addr}`, 180_000, addr, fresh, async () => 123n, scan);

describe("find_money freshness", () => {
  beforeEach(() => {
    clearScannerCache();
    resetFreshLimits();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T18:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("caches by default and keeps the original asOf and block", async () => {
    let n = 0;
    const scan = async () => ({ n: ++n });
    const r1 = await call(scan);
    vi.setSystemTime(new Date("2026-10-26T18:01:00Z"));
    const r2 = await call(scan);
    expect(n).toBe(1);
    expect(r1).toMatchObject({ n: 1, cached: false, block: 123, asOf: "2026-10-26T18:00:00.000Z" });
    expect(r2).toMatchObject({ n: 1, cached: true, block: 123, asOf: "2026-10-26T18:00:00.000Z" });
    expect(r2.freshRefused).toBeUndefined();
  });

  it("fresh skips the cache, re-scans and stamps a new asOf", async () => {
    let n = 0;
    const scan = async () => ({ n: ++n });
    await call(scan);
    vi.setSystemTime(new Date("2026-10-26T18:01:00Z"));
    const r = await call(scan, true);
    expect(n).toBe(2);
    expect(r).toMatchObject({ n: 2, cached: false, asOf: "2026-10-26T18:01:00.000Z" });
  });

  it("fresh clears this addresss inner caches, not other addresses", async () => {
    await cached(`bal:1:${A.toLowerCase()}`, 30_000, async () => 1);
    await cached(`air:${A}`, 300_000, async () => 1);
    await cached(`bal:1:${B}`, 30_000, async () => 1);
    await call(async () => ({ n: 1 }), true);
    expect(peekCached(`bal:1:${A.toLowerCase()}`, 30_000)).toBe(false);
    expect(peekCached(`air:${A}`, 300_000)).toBe(false);
    expect(peekCached(`bal:1:${B}`, 30_000)).toBe(true);
    expect(clearCachedFor("0x")).toBe(0);
  });

  it("rate-limits fresh per address and returns the cached result with a flag", async () => {
    let n = 0;
    const scan = async () => ({ n: ++n });
    await call(scan, true);
    vi.setSystemTime(new Date("2026-10-26T18:00:05Z"));
    const r = await call(scan, true);
    expect(n).toBe(1);
    expect(r).toMatchObject({
      n: 1,
      cached: true,
      freshRefused: "rate-limited",
      retryAfterSeconds: 15,
      asOf: "2026-10-26T18:00:00.000Z",
    });
    vi.setSystemTime(new Date("2026-10-26T18:00:21Z"));
    const r3 = await call(scan, true);
    expect(n).toBe(2);
    expect(r3.freshRefused).toBeUndefined();
  });

  it("the per-address window starts when the fresh scan finishes", async () => {
    await call(async () => {
      vi.setSystemTime(new Date("2026-10-26T18:00:19Z"));
      return { n: 1 };
    }, true);
    const r = await call(async () => ({ n: 2 }), true);
    expect(r).toMatchObject({ n: 1, freshRefused: "rate-limited", retryAfterSeconds: 20 });
  });

  it("has a global cap across addresses", () => {
    for (let i = 0; i < FRESH_GLOBAL_MAX; i++)
      expect(freshGate(`0x${String(i).padStart(40, "0")}`, Date.now(), `10.0.0.${i}`).ok).toBe(
        true,
      );
    const g = freshGate(B, Date.now(), "10.0.1.1");
    expect(g.ok).toBe(false);
  });

  it("block is null when the block read fails or is not EVM", async () => {
    const r = await moneyWithFreshness(`money:${A}`, 180_000, A, false, null, async () => ({}));
    expect(r.block).toBeNull();
    clearScannerCache();
    const r2 = await moneyWithFreshness(
      `money:${A}`,
      180_000,
      A,
      false,
      async () => {
        throw new Error("rpc down");
      },
      async () => ({}),
    );
    expect(r2.block).toBeNull();
  });

  it("limits fresh scans per client IP (3/min), other IPs unaffected", () => {
    const t = Date.now();
    for (let i = 0; i < FRESH_PER_IP_MAX; i++)
      expect(freshGate(`0x${String(i).padStart(40, "a")}`, t, "1.2.3.4").ok).toBe(true);
    const g = freshGate(B, t, "1.2.3.4");
    expect(g).toEqual({ ok: false, retryAfterSeconds: 60 });
    expect(freshGate(B, t, "5.6.7.8").ok).toBe(true);
    expect(freshGate(A, t + 60_001, "1.2.3.4").ok).toBe(true);
  });

  it("a second fresh=1 during an in-flight fresh scan does not clear or replace it", async () => {
    let release!: () => void;
    let n = 0;
    const slow = () =>
      new Promise<{ n: number }>((res) => {
        n++;
        release = () => res({ n });
      });
    const p1 = call(slow, true);
    // even past the per-address window, the running scan keeps the slot
    vi.setSystemTime(new Date("2026-10-26T18:00:30Z"));
    const p2 = call(async () => ({ n: 99 }), true);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(n).toBe(1);
    expect(r1).toMatchObject({ n: 1 });
    expect(r2).toMatchObject({ n: 1, freshRefused: "rate-limited" });
    // stamped at finish: refused right after, allowed once the window passes
    expect((await call(async () => ({ n: 2 }), true)).freshRefused).toBe("rate-limited");
    vi.setSystemTime(new Date("2026-10-26T18:00:51Z"));
    expect(await call(async () => ({ n: 3 }), true)).toMatchObject({ n: 3 });
  });

  it("a failed scan only removes its own cache entry", async () => {
    let fail!: (e: Error) => void;
    const p = cached("k", 60_000, () => new Promise<number>((_, rej) => (fail = rej)));
    clearScannerCache();
    const newer = cached("k", 60_000, async () => 2);
    fail(new Error("x"));
    await expect(p).rejects.toThrow("x");
    expect(peekCached("k", 60_000)).toBe(true);
    expect(await newer).toBe(2);
  });

  it("block read times out to null after 3 s", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = moneyWithFreshness(
      `money:${A}`,
      180_000,
      A,
      false,
      () => new Promise<bigint>(() => {}),
      async () => ({ n: 1 }),
    );
    await vi.advanceTimersByTimeAsync(3_001);
    expect((await p).block).toBeNull();
  });
});
