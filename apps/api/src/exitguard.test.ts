import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { EXIT_DEADLINE_S, exitDeadline, minOut } from "./exitguard.js";
import { exitTx as clExit } from "./lp.js";
import { v4ExitTx } from "./lpv4.js";
import { exitTx as pendleExit, syRedeemTx } from "./pendle.js";
import { verifyRecovery } from "./recover.js";

const own = "0x1111111111111111111111111111111111111111" as const;
const T = "0x3333333333333333333333333333333333333333";
const NPM = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const now = () => BigInt(Math.floor(Date.now() / 1000));
const DEC = parseAbiItem(
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline))",
);
const RL = parseAbiItem(
  "function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)",
);

describe("exit minimums (sandwich guard)", () => {
  it("minOut is quote minus 1%, deadline is ~20 minutes", () => {
    expect(minOut(10_000n)).toBe(9_900n);
    const d = exitDeadline();
    expect(d - now()).toBeGreaterThanOrEqual(BigInt(EXIT_DEADLINE_S - 2));
    expect(d - now()).toBeLessThanOrEqual(BigInt(EXIT_DEADLINE_S));
  });
  it("v3 decrease carries quoted mins and a short deadline; zero-min probe is rejected", () => {
    const tx = clExit(1, NPM, 7n, 100n, own, [1000n, 2000n]);
    const inner = (
      decodeFunctionData({
        abi: [parseAbiItem("function multicall(bytes[])")],
        data: tx.data as `0x${string}`,
      }).args[0] as `0x${string}`[]
    )[0]!;
    const p = decodeFunctionData({ abi: [DEC], data: inner }).args[0] as {
      amount0Min: bigint;
      amount1Min: bigint;
      deadline: bigint;
    };
    expect([p.amount0Min, p.amount1Min]).toEqual([990n, 1980n]);
    expect(p.deadline - now()).toBeLessThanOrEqual(BigInt(EXIT_DEADLINE_S));
    expect(verifyRecovery(tx, own).verified).toBe(true);
    expect(verifyRecovery(clExit(1, NPM, 7n, 100n, own), own).verified).toBe(false);
  });
  it("v3 far deadline (2^63) is rejected", () => {
    const inner = encodeFunctionData({
      abi: [DEC],
      args: [{ tokenId: 7n, liquidity: 100n, amount0Min: 1n, amount1Min: 1n, deadline: 2n ** 63n }],
    });
    expect(verifyRecovery({ to: NPM, data: inner, value: "0" }, own).verified).toBe(false);
  });
  it("v2 removeLiquidity: zero mins or far deadline rejected", () => {
    const mk = (m0: bigint, m1: bigint, d: bigint) => ({
      to: T,
      value: "0",
      data: encodeFunctionData({ abi: [RL], args: [T, T, 5n, m0, m1, own, d] }),
    });
    expect(verifyRecovery(mk(9n, 9n, exitDeadline()), own).verified).toBe(true);
    expect(verifyRecovery(mk(0n, 0n, exitDeadline()), own).verified).toBe(false);
    expect(verifyRecovery(mk(9n, 9n, 2n ** 63n), own).verified).toBe(false);
  });
  it("v4 decrease carries quoted mins and a short deadline; zero mins rejected", () => {
    const pm = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e";
    const tx = v4ExitTx(1, pm, 5n, 10n, T, T, own, [100n, 200n]);
    const [unlock, dl] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "uint256" }],
      `0x${tx.data.slice(10)}`,
    );
    expect(dl - now()).toBeLessThanOrEqual(BigInt(EXIT_DEADLINE_S));
    const [, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], unlock);
    const [, , m0, m1] = decodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "bytes" },
      ],
      params[0]!,
    );
    expect([m0, m1]).toEqual([99n, 198n]);
    expect(verifyRecovery(tx, own).verified).toBe(true);
    expect(verifyRecovery(v4ExitTx(1, pm, 5n, 10n, T, T, own, [0n, 0n]), own).verified).toBe(false);
  });
  it("Pendle exit / SY redeem need a non-zero minTokenOut", () => {
    expect(verifyRecovery(pendleExit(1, own, T, 5n, 0n, T, 4n), own).verified).toBe(true);
    expect(verifyRecovery(pendleExit(1, own, T, 5n, 0n, T), own).verified).toBe(false);
    expect(verifyRecovery(syRedeemTx(1, own, T, 5n, T, 4n), own).verified).toBe(true);
    expect(verifyRecovery(syRedeemTx(1, own, T, 5n, T), own).verified).toBe(false);
  });
});
