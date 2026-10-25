import { describe, it, expect } from "vitest";
import { bytecodeSelectors, recoveryCandidates } from "./abiprobe.js";
describe("abiprobe", () => {
  it("extracts PUSH4 selectors and skips other push data", () => {
    // PUSH1 0x63 (data, not an opcode), PUSH4 3ccfd60b, PUSH4 4e71d92d
    expect(bytecodeSelectors("0x6063633ccfd60b634e71d92d")).toEqual(["0x3ccfd60b", "0x4e71d92d"]);
  });
  it("keeps only zero-arg / (address) recovery-style names, ABI included", () => {
    const abi = [{ type: "function", name: "getReward", inputs: [], stateMutability: "nonpayable" }, { type: "function", name: "earned", inputs: [{ type: "address" }], stateMutability: "view" }];
    expect(recoveryCandidates(["withdraw()", "transfer(address,uint256)", "claim(address)", "withdraw(uint256)"], abi)).toEqual(["getReward()", "withdraw()", "claim(address)"]);
  });
});
