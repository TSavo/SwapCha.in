import { describe, expect, it, vi } from "vitest";

vi.mock("./blocktools.js", async (orig) => {
  const m = await orig<typeof import("./blocktools.js")>();
  const need = () => {
    throw new Error("blocktools unavailable");
  };
  return { ...m, blocktools: () => null, btVerifyRecovery: need, btVerifySweepTx: need };
});

describe("verifiers fail closed without blocktools (no TS fallback)", () => {
  it("throws", async () => {
    const r = await import("./recover.js");
    const s = await import("./sweepverify.js");
    const o = "0x1111111111111111111111111111111111111111";
    expect(() => r.verifyRecovery({ to: o, data: "0x3ccfd60b", value: "0" }, o)).toThrow(
      /blocktools unavailable/,
    );
    expect(() => s.verifySweepTx({ from: o, to: o, value: 1n, chainId: 1 }, o, 1)).toThrow(
      /blocktools unavailable/,
    );
  }, 60_000);
});
