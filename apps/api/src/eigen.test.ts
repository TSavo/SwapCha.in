import { describe, expect, it } from "vitest";
import { completeTx, queueTx } from "./eigen.js";
import { verifyRecovery } from "./recover.js";

const owner = "0x1111111111111111111111111111111111111111" as const;
const other = "0x2222222222222222222222222222222222222222" as const;
const w = (withdrawer: `0x${string}`) => ({
  staker: owner,
  delegatedTo: other,
  withdrawer,
  nonce: 1n,
  startBlock: 1,
  strategies: [other],
  scaledShares: [5n],
});
describe("eigenlayer txs", () => {
  it("complete only verifies when the withdrawer is the owner", () => {
    expect(verifyRecovery(completeTx(w(owner), [other]), owner).verified).toBe(true);
    expect(verifyRecovery(completeTx(w(other), [other]), owner).verified).toBe(false);
  });
  it("queueWithdrawals is a standard recovery call", () => {
    expect(verifyRecovery(queueTx([other], [5n], owner), owner).verified).toBe(true);
  });
});
