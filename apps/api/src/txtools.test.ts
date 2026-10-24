import { encodeFunctionData, maxUint256, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { broadcastTx, calldataChecks, lookalike, signingGuide, verdictOf, verifyEvm } from "./txtools.js";

const ME = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const abi = parseAbi([
  "function approve(address,uint256)",
  "function setApprovalForAll(address,bool)",
  "function transfer(address,uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)",
]);
const sev = (data: `0x${string}`, exp = {}) => calldataChecks({ from: ME, to: USDC, data, value: 0n }, exp).findings;

describe("calldata checks", () => {
  it("flags unlimited approvals, approval-for-all and Safe delegatecall", () => {
    expect(verdictOf(sev(encodeFunctionData({ abi, functionName: "approve", args: [ME, maxUint256] })))).toBe("danger");
    expect(verdictOf(sev(encodeFunctionData({ abi, functionName: "approve", args: [ME, 5n] })))).toBe("caution");
    expect(sev(encodeFunctionData({ abi, functionName: "setApprovalForAll", args: [ME, true] }))[0]!.check).toBe("approval-for-all");
    const z = "0x0000000000000000000000000000000000000000";
    const dc = encodeFunctionData({ abi, functionName: "execTransaction", args: [ME, 0n, "0x", 1, 0n, 0n, 0n, z, z, "0x"] });
    expect(sev(dc).some((f) => f.check === "delegatecall" && f.severity === "critical")).toBe(true);
  });
  it("catches address poisoning against the expected recipient", () => {
    const fake = `0xeb0e${"0".repeat(32)}5c7b`;
    expect(lookalike(fake, ME)).toBe(true);
    const f = sev(encodeFunctionData({ abi, functionName: "transfer", args: [fake as `0x${string}`, 1n] }), { recipient: ME });
    expect(f.some((x) => x.check === "address-poisoning")).toBe(true);
  });
  it("recognises owner-only recovery calls", () => {
    expect(sev("0x3ccfd60b").some((f) => f.check === "recovery")).toBe(true);
  });
  it("signing_guide always ships key recovery, the verification guide and per-tx human sign-off", () => {
    for (const c of ["evm", "solana", "tron"] as const) {
      const g = signingGuide(c);
      expect(g.steps[0]!.name).toMatch(/Key recovery/i);
      expect(g.keyRecovery.situations.length).toBeGreaterThan(5);
      expect(g.verificationGuide.length).toBeGreaterThan(5);
      expect(g.principle).toMatch(/EVERY tx|EVERY transaction/i);
    }
    const one = signingGuide("evm", "presale");
    expect(one.keyRecovery.situations).toHaveLength(1);
    expect(one.keyRecovery.situations[0]!.id).toBe("presale");
  });
});

describe.runIf(process.env.LIVE)("live (no funds move)", () => {
  it("broadcast_tx: a signed tx from an empty throwaway key is decoded, verified and rejected by the node", async () => {
    const acct = privateKeyToAccount(generatePrivateKey()); // fresh, unfunded
    const raw = await acct.signTransaction({ chainId: 1, to: USDC, data: encodeFunctionData({ abi, functionName: "approve", args: [ME, maxUint256] }), nonce: 0, gas: 60000n, maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 1n, type: "eip1559" });
    const strict = await broadcastTx(fetch, process.env, { chainId: 1, tx: raw, strict: true });
    expect(strict.broadcast).toBe(false);
    expect(strict.reason).toMatch(/strict/);
    const r = await broadcastTx(fetch, process.env, { chainId: 1, tx: raw });
    expect(r.broadcast).toBe(false);
    expect(r.reason).toMatch(/insufficient funds|balance|creation failed/i);
    expect(r.from).toBe(acct.address);
  }, 60_000);
  it("verify_tx simulates a real USDC transfer", async () => {
    const v = await verifyEvm(fetch, process.env, 1, { from: ME, to: USDC, data: encodeFunctionData({ abi, functionName: "transfer", args: [ME, 0n] }), value: "0" });
    expect(v.target.isContract).toBe(true);
    expect(v.findings.some((f) => f.check === "proxy")).toBe(true);
  }, 60_000);
});
