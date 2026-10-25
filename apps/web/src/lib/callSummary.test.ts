import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { callLine, describeCall } from "./callSummary";

const D = "0x4dbF6e1E0eA2B1D1f3e5C9a0E2f1c2C8B7A6e5D4";
const ME = "0x1111111111111111111111111111111111111111";

describe("describeCall (signing prompt shows contract + function)", () => {
  it("names a merkle airdrop claim exactly, with selector and contract", () => {
    const data = encodeFunctionData({
      abi: parseAbi(["function claim(uint256,address,uint256,bytes32[])"]),
      functionName: "claim",
      args: [7n, ME, 10n, []],
    });
    const s = describeCall(D, data);
    expect(s.contract).toBe(D);
    expect(s.selector).toBe("0x2e7ba6ef");
    expect(s.fn).toMatch(
      /^claim\(uint256 index, address account, uint256 amount, bytes32\[\] merkleProof\)$/,
    );
    expect(callLine(s)).toContain(`on contract ${D}`);
  });
  it("names no-arg claims and getReward(address)", () => {
    expect(describeCall(D, "0x3d18b912").fn).toBe("getReward()");
    const g = encodeFunctionData({
      abi: parseAbi(["function getReward(address)"]),
      functionName: "getReward",
      args: [ME],
    });
    expect(describeCall(D, g).fn).toBe("getReward(address account)");
  });
  it("unknown selector stays visible as unknown, never invented", () => {
    const s = describeCall(D, "0xdeadbeef00");
    expect(s.fn).toBeNull();
    expect(callLine(s)).toBe(`unknown function 0xdeadbeef on contract ${D}`);
  });
});
