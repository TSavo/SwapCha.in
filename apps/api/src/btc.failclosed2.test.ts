import { describe, expect, it, vi } from "vitest";

// Address decoding works but the wasm PSBT builder is unavailable: the PSBT step itself must fail closed.
vi.mock("./blocktools.js", () => ({
  btAddressToScript: () => `0014${"11".repeat(20)}`,
  btBuildPsbt: () => {
    throw new Error("blocktools unavailable");
  },
}));

describe("BTC PSBT path: wasm builder missing", () => {
  it("rejects with 'Bitcoin PSBT not built' and yields no PSBT", async () => {
    const { buildBtcPsbt } = await import("./btc.js");
    const utxos = vi.fn(async () => [{ txid: "aa".repeat(32), vout: 0, value: 100_000 }]);
    await expect(
      buildBtcPsbt(utxos, {
        from: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        to: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        amount: 10_000n,
        memo: "=:ETH.ETH:0x0",
        feeRate: 2,
      }),
    ).rejects.toThrow("Bitcoin PSBT not built: blocktools unavailable");
    expect(utxos).toHaveBeenCalledOnce();
  });
});
