import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { displayAddress } from "./address";
import { callArgs, explorerAddressUrl, type TxCall, txCallLines } from "./callSummary";

const ME = "0x1111111111111111111111111111111111111111";
const C = "0x4dbF6e1E0eA2B1D1f3e5C9a0E2f1c2C8B7A6e5D4";
const call: TxCall = {
  chainId: 1,
  chain: "Ethereum",
  contract: C,
  contractExplorerUrl: `https://etherscan.io/address/${C}`,
  selector: "0x2e1a7d4d",
  function: "withdraw",
  signature: "withdraw(uint256)",
  args: [{ name: "arg1", type: "uint256", value: "5" }],
  plain: "",
};

describe("claim call display (contract, function, selector, args, explorer)", () => {
  it("callArgs decodes args in plain words with names", () => {
    const data = encodeFunctionData({
      abi: parseAbi(["function claim(uint256,address,uint256,bytes32[])"]),
      functionName: "claim",
      args: [7n, ME, 10n, []],
    });
    expect(callArgs(data).map((a) => `${a.name} (${a.type}) = ${a.value}`)).toEqual([
      "index (uint256) = 7",
      `account (address) = ${ME}`,
      "amount (uint256) = 10",
      "merkleProof (bytes32[]) = []",
    ]);
    expect(callArgs("0xdeadbeef")).toEqual([]);
  });
  it("explorerAddressUrl links known chains only", () => {
    expect(explorerAddressUrl(8453, C)).toBe(`https://basescan.org/address/${C}`);
    expect(explorerAddressUrl(999999, C)).toBeUndefined();
    expect(explorerAddressUrl(1, "not-an-address")).toBeUndefined();
  });
  it("txCallLines states function + selector, contract and each arg", () => {
    expect(txCallLines(call)).toEqual([
      "Calls withdraw(uint256) [0x2e1a7d4d]",
      // shown EIP-55 checksummed (the fixture C is not validly cased)
      `on contract ${displayAddress(C)} (Ethereum)`,
      "arg1 (uint256) = 5",
    ]);
    expect(txCallLines({ ...call, function: null, signature: null, args: [] })[0]).toBe(
      "Calls unknown function [0x2e1a7d4d]",
    );
  });
});
