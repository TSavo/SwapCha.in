import { describe, expect, it } from "vitest";
import { HASH_REGISTERED, OLD_REGISTRAR, releaseDeedTx } from "./ensdeed.js";
import { verifyRecovery } from "./recover.js";

const H = ("0x" + "ab".repeat(32)) as `0x${string}`;
describe("ENS deeds", () => {
  it("uses the HashRegistered topic", () => {
    expect(HASH_REGISTERED).toBe(
      "0x0f0c27adfd84b60b6f456b0e87cdccb1e5fb9603991588d87fa99f5b6b61e670",
    );
  });
  it("releaseDeed tx targets the old registrar and verifies", () => {
    const tx = releaseDeedTx(H);
    expect(tx.to).toBe(OLD_REGISTRAR);
    expect(tx.data.slice(0, 10)).toBe("0x0230a07c");
    expect(verifyRecovery(tx, "0x" + "11".repeat(20)).verified).toBe(true);
  });
});
