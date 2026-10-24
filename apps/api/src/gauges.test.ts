import { describe, expect, it } from "vitest";
import { chefWithdrawTx, gaugeWithdrawTx, rewardPoolExitTx } from "./gauges.js";
import { verifyRecovery } from "./recover.js";
const O = "0x1111111111111111111111111111111111111111" as const;
const C = "0x2222222222222222222222222222222222222222";
describe("staked LP exits", () => {
  it("gauge withdraw verifies", () => expect(verifyRecovery(gaugeWithdrawTx(1, C, 5n, "x"), O).verified).toBe(true));
  it("Convex/Aura withdrawAndUnwrap verifies", () => expect(verifyRecovery(rewardPoolExitTx(1, C, 5n, "x"), O).verified).toBe(true));
  it("MasterChef v1 withdraw verifies", () => expect(verifyRecovery(chefWithdrawTx(1, C, 3, 5n, O), O).verified).toBe(true));
  it("MasterChef v2 withdrawAndHarvest to owner verifies, to stranger fails", () => {
    expect(verifyRecovery(chefWithdrawTx(2, C, 3, 5n, O), O).verified).toBe(true);
    expect(verifyRecovery(chefWithdrawTx(2, C, 3, 5n, "0x3333333333333333333333333333333333333333"), O).verified).toBe(false);
  });
});
