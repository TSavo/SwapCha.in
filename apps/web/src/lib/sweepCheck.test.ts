import { encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { checkSweepTx, txParams } from "./sweepCheck";

const ME = "0x1111111111111111111111111111111111111111";
const EVIL = "0x2222222222222222222222222222222222222222";
const TOK = "0x3333333333333333333333333333333333333333";
const native = { from: ME, to: ME, value: "1000", gas: "21000", gasPrice: "5", chainId: 10001 };

describe("checkSweepTx (fork / extra-EVM Get it back)", () => {
  it("accepts a native transfer back to the connected wallet with the right chainId", () => {
    expect(checkSweepTx(native, ME, 10001)).toBeNull();
  });
  it("fails closed on a wrong or missing chainId (EIP-155)", () => {
    expect(checkSweepTx({ ...native, chainId: 1 }, ME, 10001)).toMatch(/chainId/);
    expect(checkSweepTx({ ...native, chainId: undefined as never }, ME, 10001)).toMatch(/chainId/);
  });
  it("refuses a transfer to anyone else, from anyone else, or with calldata", () => {
    expect(checkSweepTx({ ...native, to: EVIL }, ME, 10001)).toMatch(/does not pay/);
    expect(checkSweepTx({ ...native, from: EVIL }, ME, 10001)).toMatch(/not from/);
    expect(checkSweepTx({ ...native, data: "0xdeadbeef" }, ME, 10001)).toMatch(/calldata/);
    expect(checkSweepTx(native, undefined, 10001)).toMatch(/connect/);
  });
  it("token sweep must be transfer(owner) on the expected token", () => {
    const data = (to: string) =>
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as `0x${string}`, 5n],
      });
    const t = { from: ME, to: TOK, value: "0", data: data(ME), chainId: 250 };
    expect(checkSweepTx(t, ME, 250, TOK)).toBeNull();
    expect(checkSweepTx({ ...t, data: data(EVIL) }, ME, 250, TOK)).toMatch(/does not pay/);
    expect(checkSweepTx({ ...t, to: EVIL }, ME, 250, TOK)).toMatch(/wrong token/);
    expect(checkSweepTx({ ...t, value: "1" }, ME, 250, TOK)).toMatch(/no native value/);
  });
  it("wallet params always carry the chainId", () => {
    expect(txParams(native)).toEqual({
      from: ME,
      to: ME,
      value: "0x3e8",
      gas: "0x5208",
      gasPrice: "0x5",
      chainId: "0x2711",
    });
  });
});
