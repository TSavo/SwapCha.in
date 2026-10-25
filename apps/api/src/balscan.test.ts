import { encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { decodeAgg3Uint, encodeAgg3, SEL } from "./balscan.js";

const ABI = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])",
]);
const owner = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ts = [
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
];

describe("balscan", () => {
  it("encodes aggregate3 identically to viem", () => {
    const cd = "0x70a08231" + owner.slice(2).toLowerCase().padStart(64, "0");
    const ref = encodeFunctionData({
      abi: ABI,
      functionName: "aggregate3",
      args: [
        ts.map((t) => ({
          target: t as `0x${string}`,
          allowFailure: true,
          callData: cd as `0x${string}`,
        })),
      ],
    });
    expect(encodeAgg3(ts, SEL.balanceOf, owner)).toBe(ref.toLowerCase());
  });
  it("decodes results incl. failures and short returns", () => {
    const enc = encodeAbiParameters(
      [{ type: "tuple[]", components: [{ type: "bool" }, { type: "bytes" }] }],
      [
        [
          [true, encodeAbiParameters([{ type: "uint256" }], [123n])],
          [false, "0x"],
          [true, "0x01"],
          [true, encodeAbiParameters([{ type: "uint256" }], [2n ** 200n])],
        ],
      ],
    );
    expect(decodeAgg3Uint(enc, 4)).toEqual([123n, null, null, 2n ** 200n]);
  });
});
