import { describe, expect, it } from "vitest";
import { approveTx, exitTx, maturedPendle, syRedeemTx } from "./pendle.js";
import { verifyRecovery } from "./recover.js";
const own = "0x1111111111111111111111111111111111111111" as const;
const bad = "0x2222222222222222222222222222222222222222" as const;
const T = "0x3333333333333333333333333333333333333333";
describe("pendle matured", () => {
  it("exit and SY redeem verify only to owner", () => {
    expect(verifyRecovery(exitTx(1, own, T, 5n, 0n, T, 4n), own).verified).toBe(true);
    expect(verifyRecovery(exitTx(1, bad, T, 5n, 0n, T, 4n), own).verified).toBe(false);
    expect(verifyRecovery(syRedeemTx(1, own, T, 5n, T, 4n), own).verified).toBe(true);
    expect(verifyRecovery(syRedeemTx(1, bad, T, 5n, T, 4n), own).verified).toBe(false);
  });
  it("approval verifies only for the Pendle Router", () => {
    const a = approveTx(1, T, 5n, "PT");
    expect(verifyRecovery(a, own).verified).toBe(true);
    expect(verifyRecovery({ ...a, data: a.data.replace("888888888889758f76e7103c6cbf23abbf58f946", bad.slice(2)) }, own).verified).toBe(false);
  });
  it("throws when the API is down (degrades to not-checked)", async () => {
    const f = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await expect(maturedPendle(f, {}, own)).rejects.toThrow();
  });
  it("ignores unexpired markets", async () => {
    const f = (async (u: string) => new Response(JSON.stringify(String(u).includes("dashboard")
      ? { positions: [{ chainId: 1, openPositions: [{ marketId: "1-" + T, pt: { valuation: 1, balance: "5" }, lp: { valuation: 0, balance: "0" } }], closedPositions: [], syPositions: [] }] }
      : { address: T, expiry: "2999-01-01T00:00:00.000Z", pt: { address: T, symbol: "PT" }, lp: { address: T }, sy: { address: T, symbol: "SY" } }))) as unknown as typeof fetch;
    expect(await maturedPendle(f, {}, own)).toEqual([]);
  });
});
