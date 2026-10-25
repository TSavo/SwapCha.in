import { encodeFunctionData, formatUnits, getAddress, parseAbiItem, toHex } from "viem";
import { callMany, SEL } from "./balscan.js";
import { evmClient, json, prices, pxOf, swapUrl, usdcOf } from "./onchain.js";
import type { NewFound } from "./recover.js";
import { cached } from "./scanner.js";

/**
 * Vault registry: checks every known vault share token (Yearn v2/v3, Beefy, Morpho/MetaMorpho,
 * plus curated ERC-4626 savings vaults like sDAI, sUSDS, sfrxETH, scrvUSD, sUSDe) for a balance,
 * independent of wallet history. Values come from on-chain convertToAssets / pricePerShare reads.
 * Each hit carries an unsigned recovery tx built for the owner's wallet (redeem / withdraw).
 */
type F = typeof fetch;
const fn = (s: string) => [parseAbiItem(`function ${s}`)] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type VaultKind = "4626" | "yearn2" | "beefy";
export interface VaultRef {
  chainId: number;
  address: `0x${string}`;
  kind: VaultKind;
  source: string;
}

export const VAULT_CHAINS = [1, 8453, 42161, 10, 137, 56, 43114] as const;

/** Curated ERC-4626 vaults that are not in the Yearn/Beefy/Morpho lists. */
export const CURATED_4626: VaultRef[] = (
  [
    [1, "0x83F20F44975D03b1b09e64809B757c47f1BcA168", "Maker sDAI (DSR)"],
    [1, "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD", "Sky sUSDS"],
    [1, "0xac3E018457B222d93114458476f3E3416Abbe38F", "Frax sfrxETH"],
    [1, "0x0655977FEb2f289A4aB78af67BAB0d17aAb84367", "Curve scrvUSD"],
    [1, "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497", "Ethena sUSDe"],
  ] as const
).map(([chainId, a, source]) => ({
  chainId,
  address: getAddress(a),
  kind: "4626" as const,
  source,
}));

const BEEFY_CHAIN: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  bsc: 56,
  avax: 43114,
};

/** All known vaults (lists cached 6h; each source fails soft). */
export async function vaultList(f: F): Promise<VaultRef[]> {
  return cached("vaults:list", 6 * 3600_000, async () => {
    const out: VaultRef[] = [...CURATED_4626];
    const ids = VAULT_CHAINS.join(",");
    const [yearn, beefy, morpho] = await Promise.all([
      json<{ address: string; chainID: number; version: string }[]>(
        f,
        `https://ydaemon.yearn.fi/vaults/all?chainIDs=${ids}&limit=5000`,
        undefined,
        15_000,
      ).catch(() => []),
      json<{ chain: string; earnContractAddress: string }[]>(
        f,
        "https://api.beefy.finance/vaults",
        undefined,
        15_000,
      ).catch(() => []),
      json<{ data?: { vaults?: { items?: { address: string; chain: { id: number } }[] } } }>(
        f,
        "https://api.morpho.org/graphql",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `{vaults(first:1000,where:{chainId_in:[1,8453,42161,10,137]}){items{address chain{id}}}}`,
          }),
        },
        15_000,
      ).catch(
        () =>
          ({}) as { data?: { vaults?: { items?: { address: string; chain: { id: number } }[] } } },
      ),
    ]);
    for (const v of Array.isArray(yearn) ? yearn : [])
      if (/^0x[0-9a-fA-F]{40}$/.test(v.address))
        out.push({
          chainId: v.chainID,
          address: getAddress(v.address),
          kind: v.version?.startsWith("3") ? "4626" : "yearn2",
          source: v.version?.startsWith("3") ? "Yearn v3" : "Yearn v2",
        });
    for (const v of Array.isArray(beefy) ? beefy : []) {
      const id = BEEFY_CHAIN[v.chain];
      if (id && /^0x[0-9a-fA-F]{40}$/.test(v.earnContractAddress ?? ""))
        out.push({
          chainId: id,
          address: getAddress(v.earnContractAddress),
          kind: "beefy",
          source: "Beefy",
        });
    }
    for (const v of morpho?.data?.vaults?.items ?? [])
      out.push({
        chainId: v.chain.id,
        address: getAddress(v.address),
        kind: "4626",
        source: "Morpho",
      });
    const seen = new Set<string>();
    return out.filter((v) => {
      const k = `${v.chainId}:${v.address.toLowerCase()}`;
      if (seen.has(k) || !(VAULT_CHAINS as readonly number[]).includes(v.chainId)) return false;
      seen.add(k);
      return true;
    });
  });
}

type R = { status: string; result?: unknown };
async function mc(
  chainId: number,
  env: NodeJS.ProcessEnv,
  calls: unknown[],
): Promise<(unknown | null)[]> {
  const c = evmClient(chainId, env);
  const out: (unknown | null)[] = [];
  const chunks: unknown[][] = [];
  for (let i = 0; i < calls.length; i += 500) chunks.push(calls.slice(i, i + 500));
  const res = await Promise.all(
    chunks.map((ch) =>
      c
        .multicall({ allowFailure: true, contracts: ch as never })
        .catch(() => ch.map(() => ({ status: "failure" }))),
    ),
  );
  for (const r of res) for (const x of r as R[]) out.push(x.status === "success" ? x.result : null);
  return out;
}

/** Pure: build the redeem/withdraw tx for a vault share balance. */
export function vaultRedeemTx(
  v: { chainId: number; address: `0x${string}`; kind: VaultKind },
  owner: `0x${string}`,
  shares: bigint,
) {
  if (v.kind === "4626")
    return {
      chainId: v.chainId,
      to: v.address,
      data: encodeFunctionData({
        abi: fn("redeem(uint256,address,address)"),
        functionName: "redeem",
        args: [shares, owner, owner],
      }),
      value: "0",
      description: "redeem(all shares, you, you): withdraw the underlying to your wallet",
    };
  return {
    chainId: v.chainId,
    to: v.address,
    data: encodeFunctionData({
      abi: fn("withdraw(uint256)"),
      functionName: "withdraw",
      args: [shares],
    }),
    value: "0",
    description: "withdraw(all shares): exit the vault to your wallet",
  };
}

export async function vaultPositions(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
  list?: VaultRef[],
): Promise<NewFound[]> {
  const all = list ?? (await vaultList(f));
  const byChain = new Map<number, VaultRef[]>();
  for (const v of all) byChain.set(v.chainId, [...(byChain.get(v.chainId) ?? []), v]);
  const hits: {
    v: VaultRef;
    bal: bigint;
    under: string;
    amt: bigint;
    dec: number;
    udec: number;
    sym: string;
    exact: boolean;
    now?: bigint;
    nowShares?: bigint;
  }[] = [];
  await Promise.all(
    [...byChain].map(async ([chainId, vs]) => {
      const bals = await callMany(
        chainId,
        env,
        vs.map((v) => v.address),
        SEL.balanceOf,
        owner,
      ).catch(() => [] as (bigint | null)[]);
      const held = vs
        .map((v, i) => ({ v, bal: bals[i] as bigint | null }))
        .filter((x): x is { v: VaultRef; bal: bigint } => typeof x.bal === "bigint" && x.bal > 0n);
      if (!held.length) return;
      const q = (sig: string, name: string, args?: (x: { bal: bigint }) => unknown[]) =>
        mc(
          chainId,
          env,
          held.map((x) => ({
            address: x.v.address,
            abi: fn(sig),
            functionName: name,
            ...(args ? { args: args(x) } : {}),
          })),
        );
      const [dec, sym, asset, conv, token, pps, want, ppfs, maxW, maxR] = await Promise.all([
        q("decimals() view returns (uint8)", "decimals"),
        q("symbol() view returns (string)", "symbol"),
        q("asset() view returns (address)", "asset"),
        q("convertToAssets(uint256) view returns (uint256)", "convertToAssets", (x) => [x.bal]),
        q("token() view returns (address)", "token"),
        q("pricePerShare() view returns (uint256)", "pricePerShare"),
        q("want() view returns (address)", "want"),
        q("getPricePerFullShare() view returns (uint256)", "getPricePerFullShare"),
        // ERC-4626 limits: MetaMorpho (and other lending vaults) cap these at the liquidity available right now
        q("maxWithdraw(address) view returns (uint256)", "maxWithdraw", () => [owner]),
        q("maxRedeem(address) view returns (uint256)", "maxRedeem", () => [owner]),
      ]);
      const unders = [
        ...new Set(
          held.map((_, i) => (asset[i] ?? token[i] ?? want[i]) as string | null).filter(Boolean),
        ),
      ] as `0x${string}`[];
      const udecs = await mc(
        chainId,
        env,
        unders.map((u) => ({
          address: u,
          abi: fn("decimals() view returns (uint8)"),
          functionName: "decimals",
        })),
      );
      const udecOf = new Map(unders.map((u, i) => [u.toLowerCase(), Number(udecs[i] ?? 18)]));
      held.forEach((x, i) => {
        const d = Number(dec[i] ?? 18);
        let under: string | null = null;
        let amt: bigint | null = null;
        let kind = x.v.kind;
        if (asset[i] && typeof conv[i] === "bigint") {
          under = asset[i] as string;
          amt = conv[i] as bigint;
          kind = "4626";
        } else if (token[i] && typeof pps[i] === "bigint") {
          under = token[i] as string;
          amt = ((pps[i] as bigint) * x.bal) / 10n ** BigInt(d);
          kind = "yearn2";
        } else if (want[i] && typeof ppfs[i] === "bigint") {
          under = want[i] as string;
          amt = ((ppfs[i] as bigint) * x.bal) / 10n ** 18n;
          kind = "beefy";
        }
        if (!under || amt === null || amt <= 0n) return;
        const mw = kind === "4626" && typeof maxW[i] === "bigint" ? (maxW[i] as bigint) : undefined;
        const mr = kind === "4626" && typeof maxR[i] === "bigint" ? (maxR[i] as bigint) : undefined;
        const capped = mw !== undefined && mw < amt;
        hits.push({
          ...(capped ? { now: mw, nowShares: mr !== undefined && mr < x.bal ? mr : x.bal } : {}),
          v: { ...x.v, kind },
          bal: x.bal,
          under,
          amt,
          dec: d,
          udec: udecOf.get(under.toLowerCase()) ?? 18,
          sym: String(sym[i] ?? "vault"),
          exact: kind === "4626",
        });
      });
    }),
  );
  if (!hits.length) return [];
  const px = await prices(
    f,
    hits.map((h) => ({ chainId: h.v.chainId, address: h.under })),
  ).catch(() => new Map());
  return hits.flatMap((h) => {
    const p = pxOf(px, h.v.chainId, h.under)?.price ?? null;
    const usdc = usdcOf(h.v.chainId);
    const out: NewFound[] = [];
    if (h.now !== undefined) {
      // part of the position is lent out: only maxWithdraw is claimable now; the rest is a lead
      const rest = Number(formatUnits(h.amt - h.now, h.udec));
      out.push({
        kind: "lead",
        protocol: `${h.v.source} vault ${h.sym} (locked by utilization)`,
        chainId: h.v.chainId,
        what: `${rest.toPrecision(6)} of the underlying is lent out and cannot be withdrawn right now (convertToAssets minus maxWithdraw). Check again when vault liquidity frees up.`,
        valueUsd: p ? r2(rest * p) : null,
        action: `Withdraw the rest later from ${h.sym}`,
        evidence: [
          {
            chainId: h.v.chainId,
            address: h.v.address,
            call: "maxWithdraw(address)",
            args: [owner],
            raw: toHex(h.now),
          },
        ],
        confidence: "high",
      } as unknown as NewFound);
      if (h.now === 0n || !h.nowShares) return out;
    }
    const nowAmt = h.now ?? h.amt;
    const amt = formatUnits(nowAmt, h.udec);
    out.push({
      kind: "claimable" as const,
      protocol: `${h.v.source} vault ${h.sym}`,
      chainId: h.v.chainId,
      what:
        h.now !== undefined
          ? `${Number(formatUnits(h.nowShares!, h.dec)).toPrecision(6)} of your ${Number(formatUnits(h.bal, h.dec)).toPrecision(6)} ${h.sym} shares are withdrawable now, worth ${Number(amt).toPrecision(6)} of the underlying (maxWithdraw, capped at the vault's available liquidity, exact)`
          : `${Number(formatUnits(h.bal, h.dec)).toPrecision(6)} ${h.sym} shares, worth ${Number(amt).toPrecision(6)} of the underlying token (${h.v.kind === "4626" ? "convertToAssets" : "pricePerShare"}, ${h.exact ? "exact" : "estimate"})`,
      valueUsd: p ? r2(Number(amt) * p) : null,
      claimTx: vaultRedeemTx(h.v, owner, h.nowShares ?? h.bal),
      action: `Withdraw from ${h.sym}, then swap the underlying on SwapChan`,
      ...(usdc ? { link: swapUrl(h.v.chainId, getAddress(h.under), h.v.chainId, usdc, amt) } : {}),
      evidence: [
        {
          chainId: h.v.chainId,
          address: h.v.address,
          call: "balanceOf(address)",
          abi: "balanceOf(address) view returns (uint256)",
          args: [owner],
          raw: toHex(h.bal),
        },
      ],
      confidence: h.exact ? ("high" as const) : ("medium" as const),
    } as NewFound);
    return out;
  });
}
