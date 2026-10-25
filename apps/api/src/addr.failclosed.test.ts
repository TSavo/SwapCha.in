import { describe, expect, it, vi } from "vitest";

vi.mock("./blocktools.js", async (orig) => {
  const m = await orig<typeof import("./blocktools.js")>();
  const need = () => {
    throw new Error("blocktools unavailable");
  };
  return {
    ...m,
    blocktools: () => null,
    btAddrValid: need,
    btDetectChains: need,
    btCashToLegacy: need,
  };
});

describe("address fallbacks fail closed without blocktools (no TS fallback)", () => {
  it("cashToLegacy / isXrpAddress / vmOfAddr throw", async () => {
    const u = await import("./utxochains.js");
    const l = await import("./ledgers.js");
    const i = await import("./intel.js");
    expect(() => u.cashToLegacy("bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a")).toThrow(
      /blocktools unavailable/,
    );
    expect(() => l.isXrpAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toThrow(
      /blocktools unavailable/,
    );
    expect(() => i.vmOfAddr("So11111111111111111111111111111111111111112")).toThrow(
      /blocktools unavailable/,
    );
    expect(i.vmOfAddr("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe("evm");
  }, 60_000);
});
