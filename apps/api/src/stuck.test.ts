import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionData, parseAbiItem, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { STANDARD_RECOVERY, verifyRecovery } from "./recover.js";
import { logPromoteCandidate } from "./stuck.js";

describe("STANDARD_RECOVERY covers new stuck handlers", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  it("getReward(address) verifies", () => {
    const data = encodeFunctionData({
      abi: [parseAbiItem("function getReward(address)")],
      functionName: "getReward",
      args: [owner],
    });
    expect(
      verifyRecovery({ to: "0x2222222222222222222222222222222222222222", data, value: "0" }, owner)
        .verified,
    ).toBe(true);
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
          10n,
          10n,
          owner,
          1n,
        ],
      ],
      ["claim(uint256,address,uint256,bytes32[])", [0n, owner, 1n, ["0x" + "11".repeat(32)]]],
    ] as const) {
      const data = encodeFunctionData({
        abi: [parseAbiItem(`function ${sig}`)],
        functionName: sig.split("(")[0] as never,
        args: args as never,
      });
      const r = verifyRecovery(
        { to: "0x2222222222222222222222222222222222222222", data, value: "0" },
        owner,
      );
      expect(r.verified, sig).toBe(true);
    }
  });
  it("registry includes removeLiquidity selector", () => {
    const sel = toFunctionSelector(
      "function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)",
    );
    expect(STANDARD_RECOVERY.some((r) => toFunctionSelector(`function ${r.sig}`) === sel)).toBe(
      true,
    );
  });
});

describe("logPromoteCandidate", () => {
  it("appends jsonl under SWAPCHAN_DATA_DIR", () => {
    const dir = mkdtempSync(join(tmpdir(), "swapchan-promote-"));
    try {
      logPromoteCandidate(
        { SWAPCHAN_DATA_DIR: dir },
        {
          chainId: 1,
          address: "0xabc",
          what: "earned=1",
          valueUsd: 12,
          selectors: ["0x12345678"],
        },
      );
      const line = readFileSync(join(dir, "promote-candidates.jsonl"), "utf8").trim();
      const row = JSON.parse(line);
      expect(row.address).toBe("0xabc");
      expect(row.selectors).toEqual(["0x12345678"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("merkleClaims + l2bridge builders", () => {
  it("buildMerkleClaimTx encodes claim(uint256,address,uint256,bytes32[])", async () => {
    const { buildMerkleClaimTx } = await import("./merkleClaims.js");
    const tx = buildMerkleClaimTx(
      {
        chainId: 1,
        distributor: "0x090D4613473dEE047c3f2706764f49E0821D256e",
        name: "Uniswap UNI",
      },
      "0x1111111111111111111111111111111111111111",
      { index: 0, amount: "0x64", proof: ["0x" + "11".repeat(32)] },
    );
    expect(tx.data.slice(0, 10)).toBe(
      toFunctionSelector("function claim(uint256,address,uint256,bytes32[])"),
    );
    expect(tx.to.toLowerCase()).toBe("0x090d4613473dee047c3f2706764f49e0821d256e");
    expect(
      verifyRecovery(
        { to: tx.to, data: tx.data, value: "0" },
        "0x1111111111111111111111111111111111111111",
      ).verified,
    ).toBe(true);
  });

  it("OP/Base portals and Arb outbox constants are set", async () => {
    const { OP_PORTAL, ARB_OUTBOX, ARB_NODE_INTERFACE } = await import("./l2bridge.js");
    expect(OP_PORTAL[10]).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(OP_PORTAL[8453]).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(ARB_OUTBOX).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(ARB_NODE_INTERFACE.toLowerCase()).toBe("0x00000000000000000000000000000000000000c8");
  });
});
