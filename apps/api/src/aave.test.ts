import { describe, expect, it } from "vitest";
import { aaveWithdrawTx } from "./aave.js";
import { verifyRecovery } from "./recover.js";

const owner = "0x1111111111111111111111111111111111111111" as const;
describe("aave withdraw tx", () => {
  it("withdraw(asset,max,owner) can only pay the owner", () => {
    const tx = aaveWithdrawTx(
      1,
      "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      owner,
    );
    expect(tx.data.startsWith("0x69328dec")).toBe(true);
    expect(verifyRecovery(tx, owner).verified).toBe(true);
    expect(verifyRecovery(tx, "0x2222222222222222222222222222222222222222").verified).toBe(false);
  });
});
