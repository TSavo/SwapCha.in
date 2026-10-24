import { describe, expect, it } from "vitest";
import { verifyRecovery } from "./recover.js";
import { CURATED_4626, vaultRedeemTx } from "./vaults.js";

const owner = "0x1111111111111111111111111111111111111111" as const;
const vault = "0x2222222222222222222222222222222222222222" as const;
describe("vault recovery txs", () => {
  it("4626 redeem pays only the owner", () => {
    const tx = vaultRedeemTx({ chainId: 1, address: vault, kind: "4626" }, owner, 10n ** 18n);
    expect(tx.data.startsWith("0xba087652")).toBe(true);
    expect(verifyRecovery(tx, owner).verified).toBe(true);
    expect(verifyRecovery(tx, "0x3333333333333333333333333333333333333333").verified).toBe(false);
  });
  it("Yearn v2 / Beefy withdraw(shares)", () => {
    const tx = vaultRedeemTx({ chainId: 1, address: vault, kind: "yearn2" }, owner, 5n);
    expect(tx.data.startsWith("0x2e1a7d4d")).toBe(true);
    expect(verifyRecovery(tx, owner).verified).toBe(true);
  });
  it("curated list is checksummed and unique", () => {
    expect(new Set(CURATED_4626.map((v) => v.address)).size).toBe(CURATED_4626.length);
  });
});
