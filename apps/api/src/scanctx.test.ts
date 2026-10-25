import { describe, expect, it } from "vitest";
import { BusyError, gate, scanSignal, withScanScope } from "./scanctx.js";

describe("scan scope", () => {
  it("aborts the scope's signal when the scan settles, so abandoned work is cancelled", async () => {
    let sig: AbortSignal | undefined;
    await withScanScope(10_000, async () => { sig = scanSignal(); });
    expect(sig?.aborted).toBe(true);
  });
  it("aborts at the hard deadline while still running", async () => {
    const seen = await withScanScope(30, async () => {
      const s = scanSignal()!;
      await new Promise((r) => setTimeout(r, 60));
      return s.aborted;
    });
    expect(seen).toBe(true);
  });
  it("nested scopes inherit the parent's abort", async () => {
    let inner: AbortSignal | undefined;
    await withScanScope(10_000, async () => { await withScanScope(10_000, async () => { inner = scanSignal(); }, 1000); });
    expect(inner?.aborted).toBe(true);
  });
});

describe("gate", () => {
  it("caps concurrency and rejects waiters after the wait", async () => {
    const g = gate(1, 20);
    let release!: () => void;
    const a = g.run(() => new Promise<void>((r) => (release = r)));
    await expect(g.run(async () => 1)).rejects.toBeInstanceOf(BusyError);
    const c = g.run(async () => 2);
    release();
    await a;
    expect(await c).toBe(2);
    expect(g.stats().active).toBe(0);
  });
});
