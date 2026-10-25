import { describe, expect, it, vi } from "vitest";

// No unverified TS sweep builder: when blocktools cannot build (WASM missing), no coin gets a sweep, including
// the ones outside BT_ONLY_SWEEP (BTC-family rows that used to fall back to a bitcoinjs Transaction).
const state = { wasm: true };
vi.mock("./blocktools.js", async (orig) => {
  const m = await orig<typeof import("./blocktools.js")>();
  return {
    ...m,
    btSweep: (...a: Parameters<typeof m.btSweep>) => (state.wasm ? m.btSweep(...a) : null),
  };
});
const { BT_ONLY_SWEEP, convert, utxoSweep } = await import("./utxochains.js");

const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const utxos = (n: number) =>
  (async () =>
    new Response(
      JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          txid: (i + 1).toString(16).padStart(64, "0"),
          vout: 0,
          value: "5000000000",
          satoshis: 5000000000,
        })),
      ),
    )) as unknown as typeof fetch;

describe("sweeps fail closed without blocktools", () => {
  it("doge is not BT_ONLY_SWEEP, still builds with the wasm", async () => {
    expect(BT_ONLY_SWEEP.has("doge")).toBe(false);
    state.wasm = true;
    const a = convert(BTC, "doge")!;
    const s = await utxoSweep(utxos(2), "doge", a, a);
    expect(s.builtBy).toMatch(/^blocktools /);
  });
  for (const k of ["doge", "vtc"] as const)
    it(`${k}: wasm missing => refused, no TS-built tx`, async () => {
      state.wasm = false;
      const a = convert(BTC, k)!;
      await expect(utxoSweep(utxos(2), k, a, a)).rejects.toThrow(/blocktools is unavailable/);
      state.wasm = true;
    });
});
