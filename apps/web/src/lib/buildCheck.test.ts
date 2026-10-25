import type { BuildResponse, Quote } from "@swapchan/shared";
import { encodeFunctionData, erc20Abi, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";
import { checkBuilt } from "./buildCheck";

const ME = "0x1111111111111111111111111111111111111111";
const EVIL = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x3333333333333333333333333333333333333333";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const LINK = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
const ETH = "0x0000000000000000000000000000000000000000";

const quote = (o: Record<string, unknown> = {}, approvalAddress: string | null = ROUTER) =>
  ({
    id: "q",
    provider: "x",
    request: {
      fromChainId: 1,
      toChainId: 1,
      fromToken: USDC,
      toToken: LINK,
      amount: "1000",
      slippageBps: 50,
      ...o,
    },
    approvalAddress,
  }) as unknown as Quote;
const approveData = (spender: string, amt: bigint) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as `0x${string}`, amt],
  });
const ok = (o: Partial<BuildResponse> = {}): BuildResponse =>
  ({
    chainId: 1,
    to: ROUTER,
    data: "0x12",
    value: "0",
    execution: "tx",
    verified: true,
    payoutTo: ME,
    approval: { chainId: 1, to: USDC, data: approveData(ROUTER, 1000n), value: "0" },
    ...o,
  }) as BuildResponse;

describe("checkBuilt (audit: swap card trusted API response blindly)", () => {
  it("accepts a matching payload", () => {
    expect(checkBuilt(ok(), quote(), ME)).toEqual([]);
  });
  it("rejects unverified, wrong chain, foreign payout", () => {
    expect(checkBuilt(ok({ verified: false }), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(ok({ verified: undefined }), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(ok({ chainId: 56 }), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(ok({ payoutTo: EVIL }), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(ok({ payoutTo: undefined }), quote(), ME)).not.toEqual([]);
  });
  it("rejects unlimited, foreign-spender, wrong-token approvals and value on token swaps", () => {
    const ap = (data: string, to = USDC) =>
      ({ approval: { chainId: 1, to, data, value: "0" } }) as unknown as Partial<BuildResponse>;
    expect(checkBuilt(ok(ap(approveData(ROUTER, maxUint256))), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(ok(ap(approveData(EVIL, 1000n))), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(ok(ap(approveData(ROUTER, 1000n), LINK)), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(ok({ value: "1" }), quote(), ME)).not.toEqual([]);
  });
  it("native input: value capped at the amount", () => {
    const q = quote({ fromToken: ETH });
    expect(checkBuilt(ok({ approval: undefined, value: "1000" }), q, ME)).toEqual([]);
    expect(checkBuilt(ok({ approval: undefined, value: "5000" }), q, ME)).not.toEqual([]);
  });
  it("CoW order: receiver, tokens, amount", () => {
    const order = (m: Record<string, unknown>) =>
      ok({
        execution: "order",
        approval: undefined,
        order: {
          domain: { chainId: 1 },
          types: {},
          primaryType: "Order",
          message: {
            sellToken: USDC,
            buyToken: LINK,
            sellAmount: "990",
            feeAmount: "0",
            receiver: ME,
            ...m,
          },
        },
      } as unknown as Partial<BuildResponse>);
    expect(checkBuilt(order({}), quote(), ME)).toEqual([]);
    expect(checkBuilt(order({ receiver: EVIL }), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(order({ buyToken: USDC }), quote(), ME)).not.toEqual([]);
    expect(checkBuilt(order({ sellAmount: "2000" }), quote(), ME)).not.toEqual([]);
  });
  it("non-EVM: needs verification and payout to the requested recipient", () => {
    const q = quote({
      fromChainId: 792703809,
      toChainId: 792703809,
      recipient: "So1anaRecipient111111111111111111111111111",
    });
    const ne = (o: Partial<BuildResponse>) =>
      ({
        execution: "nonevm",
        nonEvmTx: { vm: "svm", kind: "svm-base64", data: "x" },
        verified: true,
        verification: { verified: true, level: "full", checks: [{ name: "blocktools", ok: true }] },
        ...o,
      }) as unknown as BuildResponse;
    expect(
      checkBuilt(ne({ payoutTo: "So1anaRecipient111111111111111111111111111" }), q, ME),
    ).toEqual([]);
    expect(checkBuilt(ne({ payoutTo: "EvilSo1ana" }), q, ME)).not.toEqual([]);
  });
  it("caps native value on cross-chain ERC-20 swaps at the quoted bridge fee", () => {
    const xq = (v?: string) =>
      ({
        ...quote({ toChainId: 10 }),
        tx: v === undefined ? null : { value: v },
      }) as unknown as Quote;
    expect(checkBuilt(ok({ value: "1000" }), xq("1000"), ME)).toEqual([]);
    expect(checkBuilt(ok({ value: "1100" }), xq("1000"), ME)).toEqual([]);
    expect(checkBuilt(ok({ value: "1101" }), xq("1000"), ME)).not.toEqual([]);
    expect(checkBuilt(ok({ value: "0" }), xq(), ME)).toEqual([]);
    expect(checkBuilt(ok({ value: "1" }), xq(), ME)).not.toEqual([]);
    expect(checkBuilt(ok({ value: "10000000000000000000" }), xq("0"), ME)).not.toEqual([]);
  });
  it("non-EVM: VM must match the origin chain and the blocktools cross-check must have passed", () => {
    const sq = quote({ fromChainId: 792703809, fromToken: "11111111111111111111111111111111" });
    const nb = (o: Partial<BuildResponse> = {}) =>
      ({
        execution: "nonevm",
        verified: true,
        payoutTo: ME,
        nonEvmTx: { vm: "svm", kind: "svm-base64", data: "x" },
        verification: { verified: true, level: "full", checks: [{ name: "blocktools", ok: true }] },
        ...o,
      }) as BuildResponse;
    expect(checkBuilt(nb(), sq, ME)).toEqual([]);
    expect(
      checkBuilt(nb({ nonEvmTx: { vm: "bvm", kind: "bvm-psbt", data: "x" } }), sq, ME),
    ).not.toEqual([]);
    expect(
      checkBuilt(nb({ verification: { verified: true, level: "full", checks: [] } }), sq, ME),
    ).not.toEqual([]);
    expect(
      checkBuilt(
        nb({
          verification: {
            verified: true,
            level: "full",
            checks: [
              { name: "blocktools", ok: true },
              { name: "x", ok: false },
            ],
          },
        }),
        sq,
        ME,
      ),
    ).not.toEqual([]);
  });
});
