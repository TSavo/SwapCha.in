import { describe, expect, it, vi } from "vitest";

// The wasm load itself fails: createRequire's require throws for the blocktools bundle.
vi.mock("node:module", async (orig) => {
  const m = await orig<typeof import("node:module")>();
  return {
    ...m,
    createRequire: () => () => {
      throw new Error("Cannot find module blocktools_wasm.js");
    },
  };
});

const FROM = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TO = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const utxos = vi.fn(async () => [{ txid: "aa".repeat(32), vout: 0, value: 100_000 }]);

describe("BTC PSBT fails closed when the blocktools wasm is missing", () => {
  it("blocktools() is null and need()-backed builders throw", async () => {
    const bt = await import("./blocktools.js");
    expect(bt.blocktools()).toBeNull();
    expect(() => bt.btBuildPsbt("btc", [], TO, 1000n, FROM, 2, "")).toThrow(
      /blocktools unavailable/,
    );
  });
  it("buildBtcPsbt rejects and returns no PSBT (no TS fallback)", async () => {
    const { buildBtcPsbt } = await import("./btc.js");
    let out: string | undefined;
    await expect(
      (async () => {
        out = await buildBtcPsbt(utxos, { from: FROM, to: TO, amount: 10_000n, feeRate: 2 });
      })(),
    ).rejects.toThrow();
    expect(out).toBeUndefined();
  });
});
