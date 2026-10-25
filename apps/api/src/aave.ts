import { encodeFunctionData, formatUnits, getAddress, maxUint256, parseAbiItem, toHex } from "viem";
import { evmClient, prices, pxOf, swapUrl, usdcOf } from "./onchain.js";
import type { NewFound } from "./recover.js";
import { cached } from "./scanner.js";

/**
 * Aave v2/v3 supplied balances per reserve with a withdraw(asset, max, owner) tx.
 * Only emitted when the account has no debt (withdrawing collateral that backs a loan would revert).
 */
type F = typeof fetch;
const fn = (s: string) => [parseAbiItem(`function ${s}`)] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const AAVE_POOLS: { chainId: number; pool: `0x${string}`; ver: "v2" | "v3" }[] = [
  { chainId: 1, pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", ver: "v3" },
  { chainId: 8453, pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", ver: "v3" },
  { chainId: 42161, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", ver: "v3" },
  { chainId: 10, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", ver: "v3" },
  { chainId: 137, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", ver: "v3" },
  { chainId: 43114, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", ver: "v3" },
  { chainId: 56, pool: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB", ver: "v3" },
  { chainId: 1, pool: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987", ver: "v3" }, // Spark
  { chainId: 1, pool: "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9", ver: "v2" },
  { chainId: 137, pool: "0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf", ver: "v2" },
  { chainId: 43114, pool: "0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C", ver: "v2" },
];
const RD_V3 =
  "getReserveData(address) view returns ((uint256),uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)";
const RD_V2 =
  "getReserveData(address) view returns ((uint256),uint128,uint128,uint128,uint128,uint128,uint40,address,address,address,address,uint8)";

export function aaveWithdrawTx(
  chainId: number,
  pool: `0x${string}`,
  asset: `0x${string}`,
  owner: `0x${string}`,
) {
  return {
    chainId,
    to: pool,
    data: encodeFunctionData({
      abi: fn("withdraw(address,uint256,address)"),
      functionName: "withdraw",
      args: [asset, maxUint256, owner],
    }),
    value: "0",
    description: "withdraw(asset, all, you): pull your whole supplied balance back to your wallet",
  };
}

async function reserves(env: NodeJS.ProcessEnv, p: (typeof AAVE_POOLS)[number]) {
  return cached(`aave:res:${p.chainId}:${p.pool}`, 6 * 3600_000, async () => {
    const c = evmClient(p.chainId, env);
    const list = (await c.readContract({
      address: p.pool,
      abi: fn("getReservesList() view returns (address[])"),
      functionName: "getReservesList",
    })) as `0x${string}`[];
    const rd = await c.multicall({
      allowFailure: true,
      contracts: list.map((a) => ({
        address: p.pool,
        abi: fn(p.ver === "v3" ? RD_V3 : RD_V2),
        functionName: "getReserveData",
        args: [a],
      })) as never,
    });
    return list
      .map((asset, i) => {
        const r = rd[i] as { status: string; result?: unknown[] };
        const a = r.status === "success" ? (r.result?.[p.ver === "v3" ? 8 : 7] as string) : null;
        return a ? { asset, aToken: getAddress(a) } : null;
      })
      .filter((x): x is { asset: `0x${string}`; aToken: `0x${string}` } => !!x);
  });
}

export async function aaveSupplied(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<NewFound[]> {
  const out: NewFound[] = [];
  await Promise.all(
    AAVE_POOLS.map(async (p) => {
      const c = evmClient(p.chainId, env);
      const acct = (await c.readContract({
        address: p.pool,
        abi: fn(
          "getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
        ),
        functionName: "getUserAccountData",
        args: [owner],
      })) as bigint[];
      if (!acct[0] || acct[1] !== 0n) return; // nothing supplied, or has debt
      const rs = await reserves(env, p);
      const bals = await c.multicall({
        allowFailure: true,
        contracts: rs.flatMap((r) => [
          {
            address: r.aToken,
            abi: fn("balanceOf(address) view returns (uint256)"),
            functionName: "balanceOf",
            args: [owner],
          },
          {
            address: r.asset,
            abi: fn("decimals() view returns (uint8)"),
            functionName: "decimals",
          },
          { address: r.asset, abi: fn("symbol() view returns (string)"), functionName: "symbol" },
        ]) as never,
      });
      const hits = rs
        .map((r, i) => {
          const g = (k: number) => bals[i * 3 + k] as { status: string; result?: unknown };
          const b = g(0).status === "success" ? (g(0).result as bigint) : 0n;
          return { ...r, bal: b, dec: Number(g(1).result ?? 18), sym: String(g(2).result ?? "?") };
        })
        .filter((h) => h.bal > 0n);
      if (!hits.length) return;
      const px = await prices(
        f,
        hits.map((h) => ({ chainId: p.chainId, address: h.asset })),
      ).catch(() => new Map());
      const name =
        p.pool === "0xC13e21B648A5Ee794902342038FF3aDAB66BE987" ? "Spark" : `Aave ${p.ver}`;
      for (const h of hits) {
        const amt = formatUnits(h.bal, h.dec);
        const pr = pxOf(px, p.chainId, h.asset)?.price ?? null;
        const usdc = usdcOf(p.chainId);
        out.push({
          kind: "lending",
          protocol: `${name} supplied ${h.sym}`,
          chainId: p.chainId,
          what: `${Number(amt).toPrecision(6)} ${h.sym} supplied, no debt (aToken balanceOf, exact)`,
          valueUsd: pr ? r2(Number(amt) * pr) : null,
          claimTx: aaveWithdrawTx(p.chainId, p.pool, h.asset, owner),
          action: `Withdraw your ${h.sym}, then swap it on SwapChan`,
          ...(usdc ? { link: swapUrl(p.chainId, h.asset, p.chainId, usdc, amt) } : {}),
          evidence: [
            {
              chainId: p.chainId,
              address: h.aToken,
              call: "balanceOf(address)",
              abi: "balanceOf(address) view returns (uint256)",
              args: [owner],
              raw: toHex(h.bal),
            },
          ],
          confidence: "high",
        });
      }
    }).map((x) => x.catch(() => {})),
  );
  return out;
}
