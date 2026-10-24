/**
 * Published merkle airdrop trees → claim() calldata.
 * Trees are fetched on demand and cached under SWAPCHAN_DATA_DIR/merkle/.
 * UNI uses Uniswap's public chunked drop (mrkl-drop-data-chunks); others use
 * published claim maps when available.
 */
import { encodeFunctionData, formatUnits, getAddress, parseAbiItem } from "viem";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prices, pxOf, swapUrl, usdcOf, json, evmClient } from "./onchain.js";
import type { StuckFound } from "./stuck.js";
import type { Evidence } from "./recover.js";

type F = typeof fetch;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fn = (s: string) => [parseAbiItem(`function ${s}`)] as const;
const ev = (
  chainId: number,
  address: string,
  call: string,
  args: string[],
  raw: string | string[],
): Evidence => ({ chainId, address, call, args, raw });

export type ClaimRow = { index: number; amount: string; proof: string[] };

type Drop = {
  name: string;
  chainId: number;
  distributor: `0x${string}`;
  token: `0x${string}`;
  decimals?: number;
  portal: string;
  /** Resolve claim row for owner; null if ineligible / unknown. */
  lookup: (f: F, env: NodeJS.ProcessEnv, owner: `0x${string}`) => Promise<ClaimRow | null>;
};

function cacheDir(env: NodeJS.ProcessEnv) {
  const dir = join(env.SWAPCHAN_DATA_DIR || "/tmp/swapchan-merkle", "merkle");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function cachedJson<T>(
  f: F,
  env: NodeJS.ProcessEnv,
  key: string,
  url: string,
  ttlMs = 7 * 24 * 3600_000,
): Promise<T> {
  const path = join(cacheDir(env), key);
  if (existsSync(path)) {
    try {
      const st = JSON.parse(readFileSync(path, "utf8")) as { t: number; data: T };
      if (Date.now() - st.t < ttlMs) return st.data;
    } catch {}
  }
  const data = await json<T>(f, url, undefined, 60_000);
  writeFileSync(path, JSON.stringify({ t: Date.now(), data }));
  return data;
}

/** UNI: mapping.json maps chunkStart → chunkEnd; chunk file is chunks/<chunkStart>.json */
async function uniLookup(f: F, env: NodeJS.ProcessEnv, owner: `0x${string}`): Promise<ClaimRow | null> {
  const base =
    "https://raw.githubusercontent.com/Uniswap/mrkl-drop-data-chunks/main/chunks";
  const mapping = await cachedJson<Record<string, string>>(
    f,
    env,
    "uni-mapping.json",
    `${base}/mapping.json`,
  );
  const addr = owner.toLowerCase() as `0x${string}`;
  const starts = Object.keys(mapping).sort();
  // largest start <= addr
  let lo = 0,
    hi = starts.length - 1,
    best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= addr) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return null;
  const start = starts[best]!;
  const end = mapping[start]!;
  if (addr > end) return null;
  const chunk = await cachedJson<Record<string, ClaimRow & { flags?: unknown }>>(
    f,
    env,
    `uni-${start}.json`,
    `${base}/${start}.json`,
  );
  const row = chunk[addr] ?? chunk[getAddress(addr)];
  if (!row) return null;
  return { index: row.index, amount: row.amount, proof: row.proof };
}

/** Generic: flat address→{index,amount,proof} JSON at a URL (optional). */
function flatLookup(url: string, cacheKey: string) {
  return async (f: F, env: NodeJS.ProcessEnv, owner: `0x${string}`): Promise<ClaimRow | null> => {
    try {
      const map = await cachedJson<Record<string, ClaimRow>>(f, env, cacheKey, url);
      const row = map[owner.toLowerCase()] ?? map[getAddress(owner)] ?? map[owner];
      return row ?? null;
    } catch {
      return null;
    }
  };
}

/**
 * Bundled drop registry. claimsUrl / lookup pull published trees; claim() is built when a row exists.
 * ENS/OP/ARB/1INCH: optional env overrides SWAPCHAN_MERKLE_<NAME>_URL for a flat JSON map.
 */
export const PUBLISHED_DROPS: Drop[] = [
  {
    name: "Uniswap UNI",
    chainId: 1,
    distributor: "0x090D4613473dEE047c3f2706764f49E0821D256e",
    token: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    portal: "https://app.uniswap.org/claim",
    lookup: uniLookup,
  },
  {
    name: "ENS",
    chainId: 1,
    distributor: "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72",
    token: "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72",
    portal: "https://claim.ens.domains",
    lookup: async (f, env, owner) => {
      const url = env.SWAPCHAN_MERKLE_ENS_URL;
      if (!url) return null;
      return flatLookup(url, "ens-claims.json")(f, env, owner);
    },
  },
  {
    name: "1INCH",
    chainId: 1,
    distributor: "0xE295aD71242373C37C5FdA7B57F26f9eA1088AFe",
    token: "0x111111111117dC0aa78b770fA6A738034120C302",
    portal: "https://1inch.io",
    lookup: async (f, env, owner) => {
      const url = env.SWAPCHAN_MERKLE_1INCH_URL;
      if (!url) return null;
      return flatLookup(url, "1inch-claims.json")(f, env, owner);
    },
  },
  {
    name: "Optimism OP",
    chainId: 10,
    distributor: "0xEe6c5Ad861F185Be4aC151C9d0D811298bD1a483",
    token: "0x4200000000000000000000000000000000000042",
    portal: "https://app.optimism.io/airdrops",
    lookup: async (f, env, owner) => {
      const url = env.SWAPCHAN_MERKLE_OP_URL;
      if (!url) return null;
      return flatLookup(url, "op-claims.json")(f, env, owner);
    },
  },
  {
    name: "Arbitrum ARB",
    chainId: 42161,
    distributor: "0x67a24CE4321aB3aF51c2D0a4801c3E111D88C9d9",
    token: "0x912CE59144191C1204E64559FE8253a0e49E6548",
    portal: "https://arbitrum.foundation/claim",
    lookup: async (f, env, owner) => {
      const url = env.SWAPCHAN_MERKLE_ARB_URL;
      if (!url) return null;
      return flatLookup(url, "arb-claims.json")(f, env, owner);
    },
  },
];

/** Build claim() calldata from a published tree row; returns StuckFound when unclaimed. */
export async function merkleClaimFromTrees(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const out: StuckFound[] = [];
  for (const d of PUBLISHED_DROPS) {
    try {
      const row = await d.lookup(f, env, owner);
      if (!row) continue;
      const c = evmClient(d.chainId, env);
      const claimed = await c
        .readContract({
          address: d.distributor,
          abi: fn("isClaimed(uint256) view returns (bool)"),
          functionName: "isClaimed",
          args: [BigInt(row.index)],
        })
        .catch(() => true);
      if (claimed) continue;
      const dec = d.decimals ?? 18;
      const amt = Number(formatUnits(BigInt(row.amount), dec));
      const px = await prices(f, [{ chainId: d.chainId, address: d.token }]).catch(() => new Map());
      const p = pxOf(px, d.chainId, d.token)?.price ?? null;
      out.push({
        kind: "claimable",
        protocol: `${d.name} airdrop`,
        chainId: d.chainId,
        what: `${amt.toPrecision(5)} unclaimed ${d.name}`,
        valueUsd: p ? r2(amt * p) : null,
        confidence: "high",
        claimTx: {
          chainId: d.chainId,
          to: d.distributor,
          data: encodeFunctionData({
            abi: fn("claim(uint256,address,uint256,bytes32[])"),
            functionName: "claim",
            args: [BigInt(row.index), owner, BigInt(row.amount), row.proof as `0x${string}`[]],
          }),
          value: "0",
          description: `claim(${row.index}): ${d.name} merkle airdrop`,
        },
        action: "Claim airdrop, then swap on SwapChan",
        link: swapUrl(d.chainId, d.token, d.chainId, usdcOf(d.chainId)!, String(amt)),
        evidence: [
          ev(d.chainId, d.distributor, "isClaimed(uint256)", [String(row.index)], "false"),
          ev(d.chainId, d.distributor, "merkleRow", [owner, String(row.index)], row.amount),
        ],
        underlying: d.token,
      });
    } catch {}
  }
  return out;
}

/** Build claim calldata for a known row without checking isClaimed (tests / dry-run). */
export function buildMerkleClaimTx(
  drop: Pick<Drop, "chainId" | "distributor" | "name">,
  owner: `0x${string}`,
  row: ClaimRow,
) {
  return {
    chainId: drop.chainId,
    to: drop.distributor,
    data: encodeFunctionData({
      abi: fn("claim(uint256,address,uint256,bytes32[])"),
      functionName: "claim",
      args: [BigInt(row.index), owner, BigInt(row.amount), row.proof as `0x${string}`[]],
    }),
    value: "0",
    description: `claim(${row.index}): ${drop.name} merkle airdrop`,
  };
}
