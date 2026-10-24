import { describe, expect, it } from "vitest";
import { etherfiClaimTx, fraxClaimTx, staderClaimTx, swellClaimTx } from "./lst.js";
import { verifyRecovery } from "./recover.js";
const o = "0x1111111111111111111111111111111111111111" as const;
const x = "0x2222222222222222222222222222222222222222" as const;
describe("LST queue claim txs", () => {
  it("all verify for the owner", () => {
    for (const t of [etherfiClaimTx(1n), fraxClaimTx(2n, o), swellClaimTx(3n), staderClaimTx(4n)]) expect(verifyRecovery(t, o).verified).toBe(true);
  });
  it("frax recipient must be the owner", () => expect(verifyRecovery(fraxClaimTx(2n, x), o).verified).toBe(false));
});
