import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESH_GLOBAL_MAX, freshGate, moneyWithFreshness, resetFreshLimits } from "./fresh.js";
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

  it("has a global cap across addresses", () => {
    for (let i = 0; i < FRESH_GLOBAL_MAX; i++)
      expect(freshGate(`0x${String(i).padStart(40, "0")}`).ok).toBe(true);
    const g = freshGate(B);
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
});
