import { keccak256, toEventSelector, toFunctionSelector, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { btKeccak256, btSelector, btTopic } from "./blocktools.js";

/** blocktools 7a2f4c7 evmKeccak256 / evmSigHash agree with viem before SwapChan's call sites switched to them. */
describe("blocktools EVM hashing parity with viem", () => {
  it("known vectors", () => {
    expect(btKeccak256("")).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    expect(btSelector("transfer(address,uint256)")).toBe("0xa9059cbb");
    expect(btTopic("Transfer(address,address,uint256)")).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });
  it("keccak256 over lengths 0..300 and rate boundaries", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 255;
    };
    for (const L of [...Array(301).keys(), 1000, 4096]) {
      const h = toHex(Uint8Array.from({ length: L }, rnd));
      expect(btKeccak256(h)).toBe(keccak256(h));
    }
  });
  it("selectors and topics used in SwapChan", () => {
    for (const s of [
      "transfer(address,uint256)",
      "approve(address,uint256)",
      "withdraw()",
      "exit()",
      "withdraw(uint256)",
      "payout()",
      "claimCollateral()",
      "transferFrom(address,address,uint256)",
      "setApprovalForAll(address,bool)",
      "swap((address,uint256)[],bytes)",
    ])
      expect(btSelector(s)).toBe(toFunctionSelector(`function ${s}`));
    for (const s of [
      "Transfer(address,address,uint256)",
      "HashRegistered(bytes32,address,uint256,uint256)",
    ])
      expect(btTopic(s)).toBe(toEventSelector(`event ${s}`));
  });
});
