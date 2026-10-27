import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./onchain.js", async (orig) => {
  const m = await orig<typeof import("./onchain.js")>();
  return {
    ...m,
    // every RPC method fails, like an unreachable node
    evmClient: () =>
      new Proxy(
        {},
        {
          get: () => async () => {
            throw new Error("HTTP request failed. URL: https://rpc.example/secret-key-123");
          },
        },
      ) as never,
  };
});

import { moneyWithFreshness, resetFreshLimits } from "./fresh.js";
import {
  archaeologyDropLines,
  evmArchaeology,
  findMoneyHeadline,
  incompleteCount,
  makeCap,
  partialPrefix,
  recordStageFailure,
  timeoutCount,
} from "./intel.js";
import { tidyNotChecked } from "./reasons.js";
import { cached, clearScannerCache, PARTIAL_TTL_MS, peekCached } from "./scanner.js";

const A = "0x000000000000000000000000000000000000dEaD";
const call = (scan: () => Promise<object>, fresh = false) =>
  moneyWithFreshness(`money:${A}`, 180_000, A, fresh, async () => 7n, scan);
const flush = () => new Promise((r) => setImmediate(r));

describe("find_money partial results", () => {
  beforeEach(() => {
    clearScannerCache();
    resetFreshLimits();
  });
  afterEach(() => vi.useRealTimers());

  it("counts only timeout / may-be-incomplete lines and builds the headline prefix", () => {
    const nc = [
      "Merkl: not checked (timed out after 12s)",
      "history Ethereum: not checked (2 contract read batches failed; results may be incomplete)",
      "Monero: not checked (recognised only)",
    ];
    expect(incompleteCount(nc)).toBe(2);
    expect(partialPrefix(2)).toBe("Partial scan: 2 sources timed out; totals are a lower bound.");
    expect(partialPrefix(1)).toBe("Partial scan: 1 source timed out; totals are a lower bound.");
    expect(incompleteCount(["x: not checked (no API key)"])).toBe(0);
    expect(findMoneyHeadline(0, 0, 0)).not.toMatch(/Partial/);
  });

  it("a partial money result expires after ~20 s, keeping asOf/block", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-26T18:00:00Z"));
    let n = 0;
    const scan = async () => ({ n: ++n, partial: true, incompleteSources: 1 });
    const r1 = await call(scan);
    expect(r1).toMatchObject({
      partial: true,
      cached: false,
      block: 7,
      asOf: "2026-10-26T18:00:00.000Z",
    });
    await flush();
    vi.setSystemTime(new Date("2026-10-26T18:00:10Z"));
    const r2 = await call(scan);
    expect(r2).toMatchObject({ n: 1, cached: true });
    vi.advanceTimersByTime(PARTIAL_TTL_MS + 1);
    vi.setSystemTime(new Date("2026-10-26T18:00:21Z"));
    expect(peekCached(`money:${A}`, 180_000)).toBe(false);
    const r3 = await call(scan);
    expect(r3).toMatchObject({ n: 2, cached: false, asOf: "2026-10-26T18:00:21.000Z" });
  });

  it("a complete result keeps the 180 s cache", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-26T18:00:00Z"));
    let n = 0;
    const scan = async () => ({ n: ++n, partial: false, incompleteSources: 0 });
    await call(scan);
    await flush();
    vi.advanceTimersByTime(PARTIAL_TTL_MS + 1);
    vi.setSystemTime(new Date("2026-10-26T18:02:50Z"));
    expect(await call(scan)).toMatchObject({ n: 1, cached: true });
    vi.setSystemTime(new Date("2026-10-26T18:03:01Z"));
    expect(await call(scan)).toMatchObject({ n: 2, cached: false });
  });

  it("air: claimables cache is short when partial, 300 s otherwise", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-26T18:00:00Z"));
    await cached("air:p", 300_000, async () => ({ partial: true }));
    await cached("air:c", 300_000, async () => ({ partial: false }));
    await flush();
    vi.advanceTimersByTime(PARTIAL_TTL_MS + 1);
    vi.setSystemTime(new Date("2026-10-26T18:00:21Z"));
    expect(peekCached("air:p", 300_000)).toBe(false);
    expect(peekCached("air:c", 300_000)).toBe(true);
  });

  it("a newer scan under the same key is not deleted by an old partial timer", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-26T18:00:00Z"));
    await cached("air:k", 300_000, async () => ({ partial: true }));
    await flush();
    clearScannerCache();
    await cached("air:k", 300_000, async () => ({ partial: false }));
    vi.advanceTimersByTime(PARTIAL_TTL_MS + 1);
    expect(peekCached("air:k", 300_000)).toBe(true);
  });
});

describe("silent drops become notChecked lines", () => {
  it("cap() failure pushes a neutral notChecked line without leaking the URL", async () => {
    const nc: string[] = [];
    const cap = makeCap(nc, {});
    const r = await cap(
      "approvals",
      Promise.reject(new Error("fetch failed https://rpc.example/?apikey=abc123")),
      [] as number[],
      1000,
    );
    expect(r).toEqual([]);
    expect(nc).toHaveLength(1);
    expect(nc[0]).toMatch(/^approvals: not checked \(.*results may be incomplete\)$/);
    expect(nc[0]).not.toMatch(/https?:|abc123/);
    expect(incompleteCount(nc)).toBe(1);
  });

  it("explorer fallbacks and failed multicall batches are counted and reported", async () => {
    // explorer gives a non-list answer for txlist (counted as a fallback) and one token transfer, so a probe batch runs
    const f = (async (url: string) => {
      const u = String(url);
      const body = u.includes("action=tokentx")
        ? {
            result: [
              { contractAddress: "0x2222222222222222222222222222222222222222", from: A, to: A },
            ],
          }
        : u.includes("action=txlist")
          ? { result: "Error! Query timeout" }
          : { result: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as never;
    const { stats } = await evmArchaeology(f, {}, 1, A as `0x${string}`);
    expect(stats.explorerFallbacks).toBe(1);
    expect(Number(stats.failedBatches)).toBeGreaterThan(0);
    const lines = archaeologyDropLines([["Ethereum", stats]]);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toMatch(/^history Ethereum: not checked \(.*results may be incomplete\)$/);
      expect(l).not.toMatch(/https?:|secret/);
    }
    expect(archaeologyDropLines([["Base", { probed: 3 }]])).toEqual([]);
  });
});

describe("partial headline wording and non-timeout failures", () => {
  it("says timed out only for real timeouts", () => {
    expect(partialPrefix(3, 0)).toBe(
      "Partial scan: 3 sources could not be checked; totals are a lower bound.",
    );
    expect(partialPrefix(1, 0)).toBe(
      "Partial scan: 1 source could not be checked; totals are a lower bound.",
    );
    expect(partialPrefix(3, 1)).toBe(
      "Partial scan: 1 source timed out and 2 could not be checked; totals are a lower bound.",
    );
    expect(partialPrefix(2, 2)).toBe(
      "Partial scan: 2 sources timed out; totals are a lower bound.",
    );
    const nc = [
      "Merkl: not checked (timed out after 12s)",
      "history Ethereum: not checked (2 contract read batches failed; results may be incomplete)",
      "Monero: not checked (recognised only)",
    ];
    expect(timeoutCount(nc)).toBe(1);
    expect(incompleteCount(nc)).toBe(2);
  });

  it("a failed stage counts toward incompleteSources and stays in errors", () => {
    const nc: string[] = [];
    const errors: string[] = [];
    recordStageFailure(
      "balances",
      new Error("HTTP request failed. URL: https://rpc.example/secret-key-123"),
      nc,
      errors,
    );
    expect(errors).toEqual(["balances: RPC request failed"]);
    expect(nc).toEqual([
      "balances: not checked (data source request failed, results may be incomplete)",
    ]);
    const tidy = tidyNotChecked(nc);
    expect(incompleteCount(tidy)).toBe(1);
    expect(timeoutCount(tidy)).toBe(0);
    expect(partialPrefix(incompleteCount(tidy), timeoutCount(tidy))).toMatch(
      /1 source could not be checked/,
    );
    expect(nc.join()).not.toMatch(/https?:|secret/);
  });

  it("a timeout goes to notChecked only; a cancelled stage is not incomplete", () => {
    const nc: string[] = [];
    const errors: string[] = [];
    recordStageFailure("Merkl", new Error("timed out after 17s"), nc, errors);
    recordStageFailure("approvals", new Error("request cancelled"), nc, errors);
    expect(errors).toEqual(["approvals: scan finished"]);
    expect(nc).toEqual(["Merkl: not checked (timed out after 17s, results may be incomplete)"]);
    expect(timeoutCount(nc)).toBe(1);
  });

  it("no failures: no notChecked lines, not partial", () => {
    const nc: string[] = [];
    expect(incompleteCount(tidyNotChecked(nc))).toBe(0);
  });
});
