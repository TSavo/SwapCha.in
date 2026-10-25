import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbiItem } from "viem";
import { exitTx } from "./lp.js";
import { verifyRecovery } from "./recover.js";
const O = "0x1111111111111111111111111111111111111111" as const;
const NPM = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
describe("CL exit tx", () => {
  it("decrease+collect to owner verifies", () => {
    const tx = exitTx(1, NPM, 7n, 100n, O, [1000n, 2000n]);
    expect(verifyRecovery(tx, O).verified).toBe(true);
    const m = decodeFunctionData({ abi: [parseAbiItem("function multicall(bytes[])")], data: tx.data as `0x${string}` });
    expect((m.args[0] as unknown[]).length).toBe(2);
  });
  it("collect-only when no liquidity", () => {
    const tx = exitTx(1, NPM, 7n, 0n, O);
    const m = decodeFunctionData({ abi: [parseAbiItem("function multicall(bytes[])")], data: tx.data as `0x${string}` });
    expect((m.args[0] as unknown[]).length).toBe(1);
  });
  it("collect to someone else is rejected inside multicall", () => {
    const tx = exitTx(1, NPM, 7n, 100n, "0x2222222222222222222222222222222222222222", [1000n, 2000n]);
    expect(verifyRecovery(tx, O).verified).toBe(false);
  });
});
