import { describe, expect, it, vi } from "vitest";

// No unverified TS sweep builder: when blocktools cannot build (WASM missing), no coin gets a sweep, including
// the ones outside BT_ONLY_SWEEP (BTC-family rows that used to fall back to a bitcoinjs Transaction).
const state = { wasm: true };
vi.mock("./blocktools.js", async (orig) => {
  const m = await orig<typeof import("./blocktools.js")>();
  return {
    ...m,
    blocktools: () => (state.wasm ? m.blocktools() : null),
    btSweep: (...a: Parameters<typeof m.btSweep>) => (state.wasm ? m.btSweep(...a) : null),
  };
});
const { BT_ONLY_SWEEP, convert, utxoSweep } = await import("./utxochains.js");
const { prevUtxos, withPrev } = await import("./testkit/prevfix.js");

const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const seen: string[] = [];
const utxos = (k: "doge" | "vtc", n: number) => {
  const { utxos: u, prev } = prevUtxos(k, convert(BTC, k)!, Array(n).fill("5000000000"));
  return withPrev(prev, (url) => {
    seen.push(url);
    return new Response(JSON.stringify(u.map((x) => ({ ...x, satoshis: 5000000000 }))));
  });
};

describe("sweeps fail closed without blocktools", () => {
  it("doge is not BT_ONLY_SWEEP, still builds with the wasm", async () => {
    expect(BT_ONLY_SWEEP.has("doge")).toBe(false);
    state.wasm = true;
    const a = convert(BTC, "doge")!;
    const s = await utxoSweep(utxos("doge", 2), "doge", a, a);
    expect(s.builtBy).toMatch(/^blocktools /);
  });
  for (const k of ["doge", "vtc"] as const)
    it(`${k}: wasm missing => refused, no TS-built tx`, async () => {
      state.wasm = false;
      const a = convert(BTC, k)!;
      seen.length = 0;
      await expect(utxoSweep(utxos(k, 2), k, a, a)).rejects.toThrow(/blocktools is unavailable/);
      // refused before any previous-transaction fetch
      expect(seen.some((u) => /\/tx\//.test(u))).toBe(false);
      state.wasm = true;
    });
});
