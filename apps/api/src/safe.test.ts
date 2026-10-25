import { encodeFunctionData, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { verifyRecovery } from "./recover.js";
import { safeSweepTx } from "./safe.js";

const own = "0x1111111111111111111111111111111111111111" as const;
const bad = "0x2222222222222222222222222222222222222222" as const;
const T = "0x3333333333333333333333333333333333333333";
const S = "0x4444444444444444444444444444444444444444";
const xfer = (to: `0x${string}`, a: bigint) =>
  encodeFunctionData({ abi: [parseAbiItem("function transfer(address,uint256)")], args: [to, a] });
describe("safe sweep", () => {
  it("single native leg to owner verifies", () => {
    expect(
      verifyRecovery(safeSweepTx(1, S, own, [{ to: own, value: 5n, data: "0x" }]), own).verified,
    ).toBe(true);
  });
  it("multisend legs all to owner verify; one bad leg fails", () => {
    const ok = safeSweepTx(1, S, own, [
      { to: own, value: 5n, data: "0x" },
      { to: T, value: 0n, data: xfer(own, 9n) },
    ]);
    expect(verifyRecovery(ok, own).verified).toBe(true);
    const evil = safeSweepTx(1, S, own, [
      { to: own, value: 5n, data: "0x" },
      { to: T, value: 0n, data: xfer(bad, 9n) },
    ]);
    expect(verifyRecovery(evil, own).verified).toBe(false);
    expect(
      verifyRecovery(safeSweepTx(1, S, own, [{ to: bad, value: 5n, data: "0x" }]), own).verified,
    ).toBe(false);
  });
});
