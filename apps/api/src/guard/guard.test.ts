import { encodeFunctionData, erc20Abi, maxUint256, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import type { GuardCtx } from "./ctx.js";
import { ABIS } from "./evm.js";
import { type Payload, verifyPayload, verifyRevoke } from "./index.js";

const TAKER = "0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b";
const EVIL = "0x000000000000000000000000000000000000dead";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a5e5b5c4f27ead9083c756c";
const ONEINCH = "0x111111125421ca6dc452d289314280a0f8842a65";
const VAULT = "0x1111111111111111111111111111111111111111";
const THOR_ROUTER = "0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146";

const ctx: GuardCtx = {
  thorInbound: async () => [{ chain: "ETH", address: VAULT, router: THOR_ROUTER }],
  relay: async () => ({ contracts: [], solvers: [] }),
  zeroxSettlers: async () => [],
};
const req = {
  fromChainId: 1,
  toChainId: 1,
  fromToken: USDC,
  toToken: WETH,
  amount: "1000000000",
  taker: TAKER,
  slippageBps: 50,
} as Payload["req"];

const oneinch = (o: { to?: string; recv?: string; min?: bigint; value?: string }) =>
  ({
    provider: "1inch",
    req,
    toAmount: "1000000000000000000",
    approvalAddress: ONEINCH,
    tx: {
      chainId: 1,
      to: (o.to ?? ONEINCH) as `0x${string}`,
      value: o.value ?? "0",
      data: encodeFunctionData({
        abi: ABIS.oneinch,
        functionName: "swap",
        args: [
          EVIL,
          {
            srcToken: USDC,
            dstToken: WETH,
            srcReceiver: EVIL,
            dstReceiver: (o.recv ?? TAKER) as `0x${string}`,
            amount: 1000000000n,
            minReturnAmount: o.min ?? 995000000000000000n,
            flags: 0n,
          },
          "0x",
        ],
      }),
    },
  }) as Payload;

const failed = async (p: Payload) =>
  (await verifyPayload(p, ctx)).checks.filter((c) => !c.ok).map((c) => c.name);

describe("payload guard", () => {
  it("accepts an honest 1inch swap", async () => {
    const v = await verifyPayload(oneinch({}), ctx);
    expect(v.verified).toBe(true);
    expect(v.level).toBe("full");
  });
  it("rejects wrong recipient", async () => {
    expect(await failed(oneinch({ recv: EVIL }))).toContain("recipient");
  });
  it("rejects wrong router", async () => {
    expect(await failed(oneinch({ to: EVIL }))).toContain("router");
  });
  it("rejects low minOut", async () => {
    expect(await failed(oneinch({ min: 1n }))).toContain("minOut");
  });
  it("rejects native value above sell amount", async () => {
    expect((await failed(oneinch({ value: "5000000000000000000" }))).length).toBeGreaterThan(0);
  });
  it("rejects unlimited approve", async () => {
    const p = oneinch({});
    p.approval = {
      chainId: 1,
      to: USDC,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [ONEINCH, maxUint256],
      }),
    };
    expect((await verifyPayload(p, ctx)).verified).toBe(false);
  });
  it("rejects approve to a non-allowlisted spender", async () => {
    const p = oneinch({});
    p.approval = {
      chainId: 1,
      to: USDC,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [EVIL, 1000000000n],
      }),
    };
    expect((await verifyPayload(p, ctx)).verified).toBe(false);
  });
  const thor = (vault: string, memo: string) =>
    ({
      provider: "thorchain",
      req: {
        ...req,
        fromToken: "0x0000000000000000000000000000000000000000",
        toChainId: 1,
        amount: "1000000000000000000",
      },
      toAmount: "100000",
      tx: {
        chainId: 1,
        to: THOR_ROUTER,
        value: "1000000000000000000",
        data: encodeFunctionData({
          abi: parseAbi([
            "function depositWithExpiry(address vault,address asset,uint256 amount,string memo,uint256 expiration)",
          ]),
          functionName: "depositWithExpiry",
          args: [
            vault as `0x${string}`,
            "0x0000000000000000000000000000000000000000",
            1000000000000000000n,
            memo,
            9999999999n,
          ],
        }),
      },
    }) as unknown as Payload;
  it("accepts honest THORChain deposit, names the failing check otherwise", async () => {
    const ok = await verifyPayload(thor(VAULT, `=:ETH.ETH:${TAKER}:1`), ctx);
    expect(ok.checks.filter((c) => !c.ok)).toEqual([]);
    expect(await failed(thor(EVIL, `=:ETH.ETH:${TAKER}:1`))).toContain("vault");
  });
  it("rejects THORChain wrong vault", async () => {
    expect((await verifyPayload(thor(EVIL, `=:ETH.ETH:${TAKER}:1`), ctx)).verified).toBe(false);
  });
  it("rejects THORChain memo to someone else", async () => {
    expect((await verifyPayload(thor(VAULT, `=:ETH.ETH:${EVIL}:1`), ctx)).verified).toBe(false);
  });
  it("never throws on garbage", async () => {
    const p = oneinch({});
    p.tx!.data = "0xdeadbeef";
    const v = await verifyPayload(p, ctx);
    expect(v.verified).toBe(false);
  });
  it("revoke self-check", () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [ONEINCH, 0n],
    });
    expect(() => verifyRevoke({ to: USDC, data, value: "0" }, USDC, ONEINCH)).not.toThrow();
    const bad = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ONEINCH, 1n] });
    expect(() => verifyRevoke({ to: USDC, data: bad, value: "0" }, USDC, ONEINCH)).toThrow();
  });
});
