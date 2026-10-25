import { describe, expect, it } from "vitest";
import { EXTRA_EVM, evmSweep } from "./extraevm.js";
import { sweepUrl } from "./recover.js";

describe("extra EVM chains", () => {
  it("covers the 12 requested chains with distinct chain ids and public RPCs", () => {
    const ids = Object.values(EXTRA_EVM)
      .map((x) => x.chain.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual(
      [100, 130, 146, 250, 324, 999, 5000, 42220, 80094, 81457, 143, 747474].sort((a, b) => a - b),
    );
    for (const x of Object.values(EXTRA_EVM))
      expect(x.rpc.every((u) => u.startsWith("https://"))).toBe(true);
  });
  it("rejects unknown chains and bad addresses before any network call", async () => {
    await expect(evmSweep(fetch, "nope", "0x0", "0x0")).rejects.toThrow(/chain must be one of/);
    await expect(
      evmSweep(fetch, "gnosis", "0x123", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    ).rejects.toThrow(/0x addresses/);
  });
  it("sweep URL carries the token for ERC-20 sweeps", () => {
    const u = sweepUrl(
      {
        kind: "evm",
        coin: "zksync",
        from: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        sym: "USDC",
        token: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4",
      },
      "t",
    );
    expect(u).toContain("sweep=evm");
    expect(u).toContain("token=0x1d17");
  });
});
