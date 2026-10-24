import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbiItem, toFunctionSelector } from "viem";
import { verifyRecovery, STANDARD_RECOVERY } from "./recover.js";
import { logPromoteCandidate } from "./stuck.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("STANDARD_RECOVERY covers new stuck handlers", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  it("getReward(address) verifies", () => {
    const data = encodeFunctionData({
      abi: [parseAbiItem("function getReward(address)")],
      functionName: "getReward",
      args: [owner],
    });
    expect(verifyRecovery({ to: "0x2222222222222222222222222222222222222222", data, value: "0" }, owner).verified).toBe(
      true,
    );
  });
  it("claimFees / vest / removeLiquidity / merkle claim verify", () => {
    for (const [sig, args] of [
      ["claimFees()", []],
      ["vest()", []],
      [
        "removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)",
        [
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          1n,
          0n,
          0n,
          owner,
          1n,
        ],
      ],
      [
        "claim(uint256,address,uint256,bytes32[])",
        [0n, owner, 1n, ["0x" + "11".repeat(32)]],
      ],
    ] as const) {
      const data = encodeFunctionData({
        abi: [parseAbiItem(`function ${sig}`)],
        functionName: sig.split("(")[0] as never,
        args: args as never,
      });
      const r = verifyRecovery({ to: "0x2222222222222222222222222222222222222222", data, value: "0" }, owner);
      expect(r.verified, sig).toBe(true);
    }
  });
  it("registry includes removeLiquidity selector", () => {
    const sel = toFunctionSelector(
      "function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)",
    );
    expect(
      STANDARD_RECOVERY.some((r) => toFunctionSelector(`function ${r.sig}`) === sel),
    ).toBe(true);
  });
});

describe("logPromoteCandidate", () => {
  it("appends jsonl under SWAPCHAN_DATA_DIR", () => {
    const dir = mkdtempSync(join(tmpdir(), "swapchan-promote-"));
    try {
      logPromoteCandidate({ SWAPCHAN_DATA_DIR: dir }, {
        chainId: 1,
        address: "0xabc",
        what: "earned=1",
        valueUsd: 12,
        selectors: ["0x12345678"],
      });
      const line = readFileSync(join(dir, "promote-candidates.jsonl"), "utf8").trim();
      const row = JSON.parse(line);
      expect(row.address).toBe("0xabc");
      expect(row.selectors).toEqual(["0x12345678"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
