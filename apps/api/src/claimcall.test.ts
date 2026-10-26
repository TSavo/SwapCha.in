import { DatabaseSync } from "node:sqlite";
import { encodeFunctionData, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { initLinksDb, shorten } from "./intel.js";
import { describeTxCall, recoveryFlow, recoveryInfo } from "./recover.js";

const fn = (s: string) => [parseAbiItem(`function ${s}`)] as const;
const ME = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const C = "0xb3775fb83f7d12a36e0475abdd1fca35c091efbe";

describe("describeTxCall (show what the claim tx calls before signing)", () => {
  it("withdraw() on Ethereum: checksummed contract, selector, name, explorer link", () => {
    const c = describeTxCall({ chainId: 1, to: C, data: "0x3ccfd60b", value: "0" });
    expect(c.contract).toBe("0xB3775fB83F7D12A36E0475aBdD1FCA35c091efBe");
    expect(c.contractExplorerUrl).toBe(
      "https://etherscan.io/address/0xB3775fB83F7D12A36E0475aBdD1FCA35c091efBe",
    );
    expect(c).toMatchObject({
      selector: "0x3ccfd60b",
      function: "withdraw",
      signature: "withdraw()",
    });
    expect(c.args).toEqual([]);
    expect(c.plain).toBe(
      "Calls withdraw() [selector 0x3ccfd60b] on contract 0xB3775fB83F7D12A36E0475aBdD1FCA35c091efBe on Ethereum with no arguments.",
    );
  });
  it("decodes args in plain words (redeem shares to me)", () => {
    const data = encodeFunctionData({
      abi: fn("redeem(uint256,address,address)"),
      functionName: "redeem",
      args: [5n, ME, ME],
    });
    const c = describeTxCall({ chainId: 8453, to: C, data, value: "0" });
    expect(c.signature).toBe("redeem(uint256,address,address)");
    expect(c.selector).toBe(data.slice(0, 10));
    expect(c.args.map((a) => `${a.type}=${a.value}`)).toEqual([
      "uint256=5",
      `address=${ME}`,
      `address=${ME}`,
    ]);
    expect(c.contractExplorerUrl).toMatch(/^https:\/\/basescan\.org\/address\//);
    expect(c.plain).toContain("on Base with arg1 (uint256) = 5;");
  });
  it("decodes tuple args (Uniswap v3 collect)", () => {
    const data = encodeFunctionData({
      abi: fn("collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max))"),
      functionName: "collect",
      args: [{ tokenId: 9n, recipient: ME, amount0Max: 1n, amount1Max: 2n }],
    });
    const c = describeTxCall({ chainId: 10, to: C, data, value: "0" });
    expect(c.function).toBe("collect");
    expect(c.args[0]!.value).toBe(`{ tokenId: 9, recipient: ${ME}, amount0Max: 1, amount1Max: 2 }`);
  });
  it("never guesses an unknown selector, and has no link on an unknown chain", () => {
    const c = describeTxCall({ chainId: 999999, to: C, data: "0xdeadbeef00", value: "0" });
    expect(c).toMatchObject({ selector: "0xdeadbeef", function: null, signature: null, args: [] });
    expect(c.contractExplorerUrl).toBeUndefined();
    expect(c.plain).toContain("unknown function (selector 0xdeadbeef)");
  });
  it("is attached to the find_money recover step and the recovery package", () => {
    const db = new DatabaseSync(":memory:");
    initLinksDb(db);
    const tx = { chainId: 1, to: C, data: "0x3ccfd60b", value: "0", description: "withdraw()" };
    const f = recoveryFlow(db, shorten, ME, {
      title: "P3D",
      claimTx: tx,
      swapUrl: "https://swapchan.com/",
    });
    expect(f.steps[0]!.call).toMatchObject({ function: "withdraw", selector: "0x3ccfd60b" });
    const info = recoveryInfo(ME, { claimTx: tx, swapUrl: "https://swapchan.com/" });
    expect(info?.call.signature).toBe("withdraw()");
  });
});
