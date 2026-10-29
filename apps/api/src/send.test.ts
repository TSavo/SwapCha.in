import { describe, expect, it } from "vitest";
import { buildSend } from "./send.js";

// Native + a listed token (USDC) to a 0x recipient resolve fully offline (no ENS, no chain read):
// only blocktools' buildEvmTransfer + verifyTx run, so these are deterministic.
const REC = "0x19ec776FCd9005E834ACA4203838f67a2a7c2653";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 6 decimals, in the token list

describe("send (EVM) — keyless build + verifyTx guard", () => {
  it("native send on Base pays the recipient and verifies", async () => {
    const p = await buildSend(fetch, process.env, { chain: "base", to: REC, amount: "0.01" });
    if (p.family !== "evm") throw new Error("expected an evm plan");
    expect(p.family).toBe("evm");
    expect(p.recipient.toLowerCase()).toBe(REC.toLowerCase());
    expect(p.token).toBeNull();
    expect(p.tx.to.toLowerCase()).toBe(REC.toLowerCase()); // native: tx target IS the recipient
    expect(p.tx.data).toBeUndefined();
    expect(p.tx.value).toBe("10000000000000000"); // 0.01 * 1e18
    expect(p.verify?.ok).toBe(true);
  });

  it("USDC send on Base is an ERC-20 transfer to the recipient", async () => {
    const p = await buildSend(fetch, process.env, {
      chain: "base",
      to: REC,
      amount: "50",
      token: USDC_BASE,
    });
    if (p.family !== "evm") throw new Error("expected an evm plan");
    expect(p.token?.toLowerCase()).toBe(USDC_BASE.toLowerCase());
    expect(p.tx.to.toLowerCase()).toBe(USDC_BASE.toLowerCase()); // token transfer: tx target is the token
    expect(p.tx.data?.toLowerCase()).toMatch(/^0xa9059cbb/); // transfer(address,uint256) selector
    // the recipient is encoded in the calldata (last 40 hex of the first arg word)
    expect(p.tx.data?.toLowerCase()).toContain(REC.slice(2).toLowerCase());
    expect(p.tx.value).toBe("0");
    expect(p.verify?.ok).toBe(true);
  });

  it("rejects a bad amount and an unsupported chain", async () => {
    await expect(
      buildSend(fetch, process.env, { chain: "base", to: REC, amount: "0" }),
    ).rejects.toThrow(/positive decimal/);
    await expect(
      buildSend(fetch, process.env, { chain: "999999", to: REC, amount: "1" }),
    ).rejects.toThrow(/not a supported/);
  });
});
