import { encodeFunctionData } from "./blocktools.js";
/**
 * Known-contract recovery registry: exact handlers for protocols with stuck money
 * that archaeology alone can't safely withdraw. Pair with history-driven archaeology
 * (intel.ts) — archaeology on every chain; promote recurring unknown hits here.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { BITCOIN, NATIVE_TOKEN } from "@swapchan/shared";
import { formatUnits, getAddress, parseAbiItem, toHex } from "viem";
import { exitDeadline, minOut } from "./exitguard.js";
import { evmClient, json, prices, pxOf, SITE, swapUrl, usdcOf } from "./onchain.js";
import type { Evidence } from "./recover.js";

type F = typeof fetch;
const fn = (s: string) => [parseAbiItem(`function ${s}`)] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ev = (
  chainId: number,
  address: string,
  call: string,
  args: string[],
  raw: string | string[],
  abi?: string,
  block?: string,
): Evidence => ({ chainId, address, call, abi, args, raw, block });

export interface StuckFound {
  kind: "claimable" | "legacy" | "lending" | "lead";
  protocol: string;
  chainId: number;
  what: string;
  valueUsd: number | null;
  claimTx?:
    | { chainId: number; to: string; data: string; value: string; description: string }
    | { chainId: number; tronTx: unknown; description: string }
    | { chainId: number; solanaTx: unknown; description: string };
  action: string;
  link?: string;
  risk?: string;
  underlying?: string;
  evidence?: Evidence[];
  /** When archaeology-style: how sure we are this is recoverable money. */
  confidence?: "high" | "medium" | "low";
  /** Recovery-looking function selectors discovered on an unknown contract. */
  recoveryHints?: { name: string; selector: string; abi?: string }[];
}

// ---------- promote-to-registry log (recurring unknown contracts with money) ----------
export function logPromoteCandidate(
  env: NodeJS.ProcessEnv,
  row: {
    chainId: number;
    address: string;
    what: string;
    valueUsd: number | null;
    selectors?: string[];
  },
) {
  const dir = env.SWAPCHAN_DATA_DIR;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      `${dir}/promote-candidates.jsonl`,
      JSON.stringify({ t: new Date().toISOString(), ...row }) + "\n",
    );
  } catch {}
}

// ---------- Curve gauges + Convex ----------
const CRV = "0xD533a949740bb3306d119CC777fa900bA034cd52" as const;
const CVX = "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B" as const;
/** GaugeController + common Convex Booster. Gauges discovered via wallet history archaeology;
 *  this handler covers the known Convex reward + claim path when CRV/CVX sitting in Booster. */
const CONVEX_BOOSTER = "0xF403C135812408BFbE8713b5A23a04b3D48AAE31" as const;
const CONVEX_REWARD = "0xCF50b810E57Ac33B91dCF525C6ddd9881B139332" as const; // cvxCRV rewards

export async function curveConvex(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const c = evmClient(1, env);
  const out: StuckFound[] = [];
  // Convex: claimable CRV/CVX via common reward contracts the wallet holds cvx deposit tokens for
  // Probe earned() on Convex reward + cvxCRV staking
  const probes: { addr: `0x${string}`; name: string; claim: string }[] = [
    { addr: CONVEX_REWARD, name: "Convex cvxCRV rewards", claim: "getReward(address)" },
    {
      addr: "0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e" as `0x${string}`,
      name: "Convex cvxCRV locker rewards",
      claim: "getReward(address)",
    },
  ];
  const px = await prices(f, [
    { chainId: 1, address: CRV },
    { chainId: 1, address: CVX },
    { chainId: 1, address: NATIVE_TOKEN },
  ]).catch(() => new Map());
  for (const p of probes) {
    const earned = await c
      .readContract({
        address: p.addr,
        abi: fn("earned(address) view returns (uint256)"),
        functionName: "earned",
        args: [owner],
      })
      .catch(() => 0n);
    if (typeof earned !== "bigint" || earned <= 0n) continue;
    const amt = Number(formatUnits(earned, 18));
    const crvP = pxOf(px, 1, CRV)?.price ?? null;
    out.push({
      kind: "claimable",
      protocol: p.name,
      chainId: 1,
      what: `${amt.toPrecision(5)} claimable reward units on ${p.name}`,
      valueUsd: crvP ? r2(amt * crvP) : null,
      confidence: "medium",
      claimTx: {
        chainId: 1,
        to: p.addr,
        data: encodeFunctionData({
          abi: fn("getReward(address)"),
          functionName: "getReward",
          args: [owner],
        }),
        value: "0",
        description: `getReward(you): claim ${p.name}`,
      },
      action: "Claim rewards, then swap on SwapChan",
      link: swapUrl(1, CRV, 1, usdcOf(1)!, String(amt)),
      evidence: [
        ev(
          1,
          p.addr,
          "earned(address)",
          [owner],
          toHex(earned),
          "earned(address) view returns (uint256)",
        ),
      ],
      underlying: CRV,
    });
  }
  // Curve gauges: claimable_tokens + staked LP on well-known gauges
  const GAUGES: { addr: `0x${string}`; name: string }[] = [
    { addr: "0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A", name: "Curve 3pool gauge" },
    { addr: "0x7ca5b0a2910B33e9759DC7dDB0413949071D7575", name: "Curve renBTC gauge" },
    { addr: "0xBC89Cd062d8201503f2F52cC4b88dFb17fc2b1A0", name: "Curve sETH gauge" },
  ];
  for (const g of GAUGES) {
    const [staked, claimable] = await Promise.all([
      c
        .readContract({
          address: g.addr,
          abi: fn("balanceOf(address) view returns (uint256)"),
          functionName: "balanceOf",
          args: [owner],
        })
        .catch(() => 0n),
      c
        .readContract({
          address: g.addr,
          abi: fn("claimable_tokens(address) view returns (uint256)"),
          functionName: "claimable_tokens",
          args: [owner],
        })
        .catch(() => 0n),
    ]);
    if (typeof claimable === "bigint" && claimable > 10n ** 14n) {
      const amt = Number(formatUnits(claimable, 18));
      const crvP = pxOf(px, 1, CRV)?.price ?? null;
      out.push({
        kind: "claimable",
        protocol: g.name,
        chainId: 1,
        what:
          `${amt.toPrecision(5)} claimable CRV` +
          (typeof staked === "bigint" && staked > 0n
            ? ` (staked LP ${Number(formatUnits(staked, 18)).toPrecision(5)})`
            : ""),
        valueUsd: crvP ? r2(amt * crvP) : null,
        confidence: "high",
        claimTx: {
          chainId: 1,
          to: "0xd061D61a4d941c39E5453435B6345Dc261C2fcE0", // Curve Minter
          data: encodeFunctionData({
            abi: fn("mint(address)"),
            functionName: "mint",
            args: [g.addr],
          }),
          value: "0",
          description: `mint(${g.name}): claim CRV from gauge`,
        },
        action: "Mint/claim CRV, then swap on SwapChan",
        link: swapUrl(1, CRV, 1, usdcOf(1)!, String(amt)),
        evidence: [
          ev(1, g.addr, "claimable_tokens(address)", [owner], toHex(claimable)),
          ...(typeof staked === "bigint" && staked > 0n
            ? [ev(1, g.addr, "balanceOf(address)", [owner], toHex(staked))]
            : []),
        ],
        underlying: CRV,
      });
    } else if (typeof staked === "bigint" && staked > 10n ** 15n) {
      out.push({
        kind: "legacy",
        protocol: g.name,
        chainId: 1,
        what: `${Number(formatUnits(staked, 18)).toPrecision(5)} LP staked in gauge (withdraw via gauge.withdraw)`,
        valueUsd: null,
        confidence: "medium",
        action: "Withdraw LP from gauge, remove liquidity, swap on SwapChan",
        link: "https://curve.fi",
        evidence: [ev(1, g.addr, "balanceOf(address)", [owner], toHex(staked))],
      });
    }
  }
  void CONVEX_BOOSTER;
  void f;
  return out;
}

// ---------- Synthetix escrow + rewards (SNX) ----------
const SNX = "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F" as const;
const SNX_FEE_POOL = "0xb440DD674e1243644791a4AdfE3A2AbB0A92d309" as const; // ProxyFeePool
const SNX_REWARD_ESCROW = "0xFAd53Cc9480634563E8ec71E8e693Ffd07981d38" as const; // RewardEscrowV2
const SNX_LIQUIDATOR_REWARDS = "0xf79603a71144e415730C1A6f57F366E4Ea962C00" as const;

export async function synthetixStuck(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const c = evmClient(1, env);
  const out: StuckFound[] = [];
  // FeePool: feesAvailable(address) → (sUSD, SNX)
  const fees = await c
    .readContract({
      address: SNX_FEE_POOL,
      abi: fn("feesAvailable(address) view returns (uint256,uint256)"),
      functionName: "feesAvailable",
      args: [owner],
    })
    .catch(() => null);
  if (fees && Array.isArray(fees)) {
    const [sUsd, snx] = fees as [bigint, bigint];
    if (sUsd > 0n || snx > 0n) {
      const snxAmt = Number(formatUnits(snx, 18));
      const px = await prices(f, [{ chainId: 1, address: SNX }]).catch(() => new Map());
      const p = pxOf(px, 1, SNX)?.price ?? null;
      out.push({
        kind: "claimable",
        protocol: "Synthetix FeePool",
        chainId: 1,
        what: `Fees available: ${Number(formatUnits(sUsd, 18)).toPrecision(5)} sUSD + ${snxAmt.toPrecision(5)} SNX`,
        valueUsd: p ? r2(snxAmt * p) : null,
        confidence: "high",
        claimTx: {
          chainId: 1,
          to: SNX_FEE_POOL,
          data: encodeFunctionData({ abi: fn("claimFees()"), functionName: "claimFees" }),
          value: "0",
          description: "claimFees(): claim Synthetix trading fees + rewards",
        },
        action: "Claim fees, then swap SNX/sUSD on SwapChan",
        link: swapUrl(1, SNX, 1, usdcOf(1)!),
        evidence: [
          ev(
            1,
            SNX_FEE_POOL,
            "feesAvailable(address)",
            [owner],
            [toHex(sUsd), toHex(snx)],
            "feesAvailable(address) view returns (uint256,uint256)",
          ),
        ],
      });
    }
  }
  // Escrow: balanceOf vested/claimable
  const escrowBal = await c
    .readContract({
      address: SNX_REWARD_ESCROW,
      abi: fn("balanceOf(address) view returns (uint256)"),
      functionName: "balanceOf",
      args: [owner],
    })
    .catch(() => 0n);
  if (typeof escrowBal === "bigint" && escrowBal > 10n ** 15n) {
    const amt = Number(formatUnits(escrowBal, 18));
    const px = await prices(f, [{ chainId: 1, address: SNX }]).catch(() => new Map());
    const p = pxOf(px, 1, SNX)?.price ?? null;
    out.push({
      kind: "legacy",
      protocol: "Synthetix RewardEscrow",
      chainId: 1,
      what: `${amt.toPrecision(5)} SNX in escrow (vest when unlocked)`,
      valueUsd: p ? r2(amt * p) : null,
      confidence: "medium",
      claimTx: {
        chainId: 1,
        to: SNX_REWARD_ESCROW,
        data: encodeFunctionData({ abi: fn("vest()"), functionName: "vest" }),
        value: "0",
        description: "vest(): claim unlocked escrowed SNX",
      },
      action: "Vest unlocked SNX on staking.synthetix.io, then swap",
      link: "https://staking.synthetix.io",
      evidence: [
        ev(
          1,
          SNX_REWARD_ESCROW,
          "balanceOf(address)",
          [owner],
          toHex(escrowBal),
          "balanceOf(address) view returns (uint256)",
        ),
      ],
      underlying: SNX,
    });
  }
  // LiquidatorRewards: earned(address)
  const liq = await c
    .readContract({
      address: SNX_LIQUIDATOR_REWARDS,
      abi: fn("earned(address) view returns (uint256)"),
      functionName: "earned",
      args: [owner],
    })
    .catch(() => 0n);
  if (typeof liq === "bigint" && liq > 10n ** 15n) {
    const amt = Number(formatUnits(liq, 18));
    const px = await prices(f, [{ chainId: 1, address: SNX }]).catch(() => new Map());
    const p = pxOf(px, 1, SNX)?.price ?? null;
    out.push({
      kind: "claimable",
      protocol: "Synthetix LiquidatorRewards",
      chainId: 1,
      what: `${amt.toPrecision(5)} SNX earned from liquidator rewards`,
      valueUsd: p ? r2(amt * p) : null,
      confidence: "high",
      claimTx: {
        chainId: 1,
        to: SNX_LIQUIDATOR_REWARDS,
        data: encodeFunctionData({
          abi: fn("getReward(address)"),
          functionName: "getReward",
          args: [owner],
        }),
        value: "0",
        description: "getReward(you): claim Synthetix liquidator rewards",
      },
      action: "Claim SNX, then swap on SwapChan",
      link: swapUrl(1, SNX, 1, usdcOf(1)!, String(amt)),
      evidence: [
        ev(
          1,
          SNX_LIQUIDATOR_REWARDS,
          "earned(address)",
          [owner],
          toHex(liq),
          "earned(address) view returns (uint256)",
        ),
      ],
      underlying: SNX,
    });
  }
  // Escrow: prefer totalEscrowedAccountBalance
  const escrowTotal = await c
    .readContract({
      address: SNX_REWARD_ESCROW,
      abi: fn("totalEscrowedAccountBalance(address) view returns (uint256)"),
      functionName: "totalEscrowedAccountBalance",
      args: [owner],
    })
    .catch(() => 0n);
  if (
    typeof escrowTotal === "bigint" &&
    escrowTotal > 10n ** 15n &&
    !out.some((x) => x.protocol === "Synthetix RewardEscrow")
  ) {
    const amt = Number(formatUnits(escrowTotal, 18));
    const px = await prices(f, [{ chainId: 1, address: SNX }]).catch(() => new Map());
    const p = pxOf(px, 1, SNX)?.price ?? null;
    out.push({
      kind: "legacy",
      protocol: "Synthetix RewardEscrow",
      chainId: 1,
      what: `${amt.toPrecision(5)} SNX in escrow (vest when unlocked)`,
      valueUsd: p ? r2(amt * p) : null,
      confidence: "medium",
      claimTx: {
        chainId: 1,
        to: SNX_REWARD_ESCROW,
        data: encodeFunctionData({ abi: fn("vest()"), functionName: "vest" }),
        value: "0",
        description: "vest(): claim unlocked escrowed SNX",
      },
      action: "Vest unlocked SNX on staking.synthetix.io, then swap",
      link: "https://staking.synthetix.io",
      evidence: [
        ev(
          1,
          SNX_REWARD_ESCROW,
          "totalEscrowedAccountBalance(address)",
          [owner],
          toHex(escrowTotal),
        ),
      ],
      underlying: SNX,
    });
  }
  return out;
}

// ---------- Sablier v1 / v2 ----------
const SABLIER_V1 = "0xA4fc358455Febe425536fd1878bE67FfDBDEC59e" as const; // legacy Payroll
const SABLIER_V2_LOCKUP_LINEAR = "0x3962f6585946823440d274aD7C719B02b49DE51E" as const; // LockupLinear v1.2

export async function sablierStuck(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const c = evmClient(1, env);
  const out: StuckFound[] = [];
  // v2: balanceOf NFT positions
  for (const [addr, name] of [
    [SABLIER_V2_LOCKUP_LINEAR, "Sablier v2 LockupLinear"],
    ["0x7a43F8a888fa15e68C103E18b0439Eb1e98a6304", "Sablier v2 LockupDynamic"],
  ] as const) {
    const n = await c
      .readContract({
        address: addr as `0x${string}`,
        abi: fn("balanceOf(address) view returns (uint256)"),
        functionName: "balanceOf",
        args: [owner],
      })
      .catch(() => 0n);
    if (typeof n !== "bigint" || n <= 0n) continue;
    let withdrawable = 0n;
    let firstId: bigint | null = null;
    const max = n > 5n ? 5n : n;
    const ids: bigint[] = [];
    for (let i = 0n; i < max; i++) {
      const id = await c
        .readContract({
          address: addr as `0x${string}`,
          abi: fn("tokenOfOwnerByIndex(address,uint256) view returns (uint256)"),
          functionName: "tokenOfOwnerByIndex",
          args: [owner, i],
        })
        .catch(() => null);
      if (typeof id === "bigint") ids.push(id);
    }
    // LockupLinear is not ERC721Enumerable — fall back to explorer NFT inventory
    if (!ids.length) {
      try {
        const url = `https://eth.blockscout.com/api/v2/addresses/${owner}/nft?type=ERC-721`;
        const r = await f(url, { signal: AbortSignal.timeout(12_000) });
        if (r.ok) {
          const j = (await r.json()) as {
            items?: { id?: string; token?: { address_hash?: string; address?: string } }[];
          };
          const want = addr.toLowerCase();
          for (const it of j.items ?? []) {
            const a = (it.token?.address_hash || it.token?.address || "").toLowerCase();
            if (a !== want || !it.id) continue;
            try {
              ids.push(BigInt(it.id));
            } catch {
              /* skip */
            }
            if (ids.length >= Number(max)) break;
          }
        }
      } catch {
        /* explorer unavailable */
      }
    }
    if (!ids.length) {
      try {
        const bn = await c.getBlockNumber();
        const fromBlock = bn > 50_000n ? bn - 50_000n : 0n;
        const logs = await c.getLogs({
          address: addr as `0x${string}`,
          event: parseAbiItem(
            "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
          ),
          args: { to: owner },
          fromBlock,
          toBlock: bn,
        });
        for (const log of logs) {
          const tid = (log as { args?: { tokenId?: bigint } }).args?.tokenId;
          if (typeof tid !== "bigint") continue;
          const cur = await c
            .readContract({
              address: addr as `0x${string}`,
              abi: fn("ownerOf(uint256) view returns (address)"),
              functionName: "ownerOf",
              args: [tid],
            })
            .catch(() => null);
          if (typeof cur === "string" && (cur as string).toLowerCase() === owner.toLowerCase())
            ids.push(tid);
          if (ids.length >= Number(max)) break;
        }
      } catch {
        /* RPC range limits — detection still reports NFT count */
      }
    }
    for (const id of ids) {
      if (firstId === null) firstId = id;
      const w = await c
        .readContract({
          address: addr as `0x${string}`,
          abi: fn("withdrawableAmountOf(uint256) view returns (uint128)"),
          functionName: "withdrawableAmountOf",
          args: [id],
        })
        .catch(() => 0n);
      if (typeof w === "bigint") withdrawable += w;
    }
    out.push({
      kind: "claimable",
      protocol: name,
      chainId: 1,
      what:
        withdrawable > 0n
          ? `${n} stream NFT(s), ${Number(formatUnits(withdrawable, 18)).toPrecision(5)} withdrawable (token units)`
          : `${n} Sablier stream NFT(s) — withdraw streamed tokens on app.sablier.com`,
      valueUsd: null,
      confidence: withdrawable > 0n ? "high" : "medium",
      ...(firstId !== null
        ? {
            claimTx: {
              chainId: 1,
              to: addr,
              data: encodeFunctionData({
                abi: fn("withdrawMax(uint256,address)"),
                functionName: "withdrawMax",
                args: [firstId, owner],
              }),
              value: "0",
              description: `withdrawMax(streamId=${firstId}): claim streamed tokens`,
            },
          }
        : {}),
      action: "Withdraw from each Sablier stream, then swap on SwapChan",
      link: "https://app.sablier.com",
      evidence: [
        ev(
          1,
          addr,
          "balanceOf(address)",
          [owner],
          toHex(n),
          "balanceOf(address) view returns (uint256)",
        ),
        ...(withdrawable > 0n && firstId !== null
          ? [ev(1, addr, "withdrawableAmountOf(uint256)", [String(firstId)], toHex(withdrawable))]
          : []),
      ],
    });
  }
  void SABLIER_V1;
  void f;
  void env;
  return out;
}

// ---------- Pendle PT/YT/LP + rewards ----------
const PENDLE_ROUTER = "0x888888888889758F76e7103c6CbF23ABbF58F946" as const;

export async function pendleStuck(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  // Pendle positions are ERC-20 PT/YT/LP tokens — archaeology balanceOf already finds them.
  // Here: claim protocol rewards via PendleRewardManager if wallet interacted.
  const c = evmClient(1, env);
  const out: StuckFound[] = [];
  // Common: VePendle / voting escrow leftover
  const VE = "0x4f30A9D41B80ecC5B94306AB4364951AE3170210" as `0x${string}`; // vePENDLE VotingEscrow
  const PENDLE = "0x808507121B80c02388fAd14726482e061B8da827" as const;
  const pos = await c
    .readContract({
      address: VE,
      abi: fn("positionData(address) view returns (uint128,uint128)"),
      functionName: "positionData",
      args: [owner],
    })
    .catch(() => null);
  const bal = pos && Array.isArray(pos) ? (pos[0] as bigint) : 0n;
  if (bal > 0n) {
    const amt = Number(formatUnits(bal, 18));
    const px = await prices(f, [{ chainId: 1, address: PENDLE }]).catch(() => new Map());
    const p = pxOf(px, 1, PENDLE)?.price ?? null;
    out.push({
      kind: "legacy",
      protocol: "Pendle vePENDLE",
      chainId: 1,
      what: `${amt.toPrecision(5)} PENDLE locked as vePENDLE — unlock/claim on app.pendle.finance`,
      valueUsd: p ? r2(amt * p) : null,
      confidence: "high",
      action: "Manage lock on Pendle app, then swap unlocked PENDLE on SwapChan",
      link: "https://app.pendle.finance/ve",
      evidence: [ev(1, VE, "positionData(address)", [owner], toHex(bal))],
      underlying: PENDLE,
    });
  }
  void PENDLE_ROUTER;
  void f;
  return out;
}

// ---------- GMX esGMX / rewards (Arbitrum) ----------
const GMX = "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a" as const;
const GMX_REWARD_ROUTER = "0xA906F338CB21815cBc4Bc87ace9e68c87eF8d8F1" as const;
const GMX_FEE_GMX = "0xd2D1162512F585Bb71e27b8C4bB6f5f3a5a6C8a0" as const; // may vary

export async function gmxStuck(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const c = evmClient(42161, env);
  const out: StuckFound[] = [];
  // Staked GMX reward tracker (esGMX token self-destructed; tracker still holds staked balances)
  const STAKED_GMX = "0x908C4D94D34924765f1eDc22A1DD098397c59dD4" as `0x${string}`;
  const staked = await c
    .readContract({
      address: STAKED_GMX,
      abi: fn("balanceOf(address) view returns (uint256)"),
      functionName: "balanceOf",
      args: [owner],
    })
    .catch(() => 0n);
  const claimable = await c
    .readContract({
      address: STAKED_GMX,
      abi: fn("claimable(address) view returns (uint256)"),
      functionName: "claimable",
      args: [owner],
    })
    .catch(() => 0n);
  const px = await prices(f, [{ chainId: 42161, address: GMX }]).catch(() => new Map());
  const p = pxOf(px, 42161, GMX)?.price ?? null;
  if (typeof staked === "bigint" && staked > 10n ** 15n) {
    const amt = Number(formatUnits(staked, 18));
    out.push({
      kind: "legacy",
      protocol: "GMX staked",
      chainId: 42161,
      what: `${amt.toPrecision(5)} staked GMX/esGMX on RewardTracker`,
      valueUsd: p ? r2(amt * p) : null,
      confidence: "high",
      action: "Unstake / vest on app.gmx.io/#/earn, then swap on SwapChan",
      link: "https://app.gmx.io/#/earn",
      evidence: [ev(42161, STAKED_GMX, "balanceOf(address)", [owner], toHex(staked))],
      underlying: GMX,
    });
  }
  if (typeof claimable === "bigint" && claimable > 0n) {
    const amt = Number(formatUnits(claimable, 18));
    out.push({
      kind: "claimable",
      protocol: "GMX rewards",
      chainId: 42161,
      what: `${amt.toPrecision(5)} claimable on GMX Staked tracker`,
      valueUsd: p ? r2(amt * p) : null,
      confidence: "high",
      claimTx: {
        chainId: 42161,
        to: GMX_REWARD_ROUTER,
        data: encodeFunctionData({
          abi: fn("handleRewards(bool,bool,bool,bool,bool,bool,bool)"),
          functionName: "handleRewards",
          args: [true, true, true, true, true, true, true],
        }),
        value: "0",
        description: "handleRewards(...): claim GMX staking rewards",
      },
      action: "Claim on GMX, then swap",
      link: "https://app.gmx.io/#/earn",
      evidence: [ev(42161, STAKED_GMX, "claimable(address)", [owner], toHex(claimable))],
      underlying: GMX,
    });
  }
  void GMX_FEE_GMX;
  return out;
}

// ---------- Rocket Pool rETH ----------
const RETH = "0xae78736Cd615f374D3085123A210448E74Fc6393" as const;
const RETH_DEPOSIT_POOL = "0xDD3f50F71E4dF2FAd9dDCBf08355128Db2Ee9f5f" as const; // RocketDepositPool (legacy)

export async function rocketPoolStuck(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const c = evmClient(1, env);
  const bal = await c
    .readContract({
      address: RETH,
      abi: fn("balanceOf(address) view returns (uint256)"),
      functionName: "balanceOf",
      args: [owner],
    })
    .catch(() => 0n);
  if (typeof bal !== "bigint" || bal <= 10n ** 12n) return [];
  const rate = await c
    .readContract({
      address: RETH,
      abi: fn("getExchangeRate() view returns (uint256)"),
      functionName: "getExchangeRate",
    })
    .catch(() => 10n ** 18n);
  const eth = (bal * (rate as bigint)) / 10n ** 18n;
  const amt = Number(formatUnits(eth, 18));
  const px = await prices(f, [{ chainId: 1, address: NATIVE_TOKEN }]).catch(() => new Map());
  const p = pxOf(px, 1, NATIVE_TOKEN)?.price ?? null;
  return [
    {
      kind: "claimable",
      protocol: "Rocket Pool rETH",
      chainId: 1,
      what: `${Number(formatUnits(bal, 18)).toPrecision(5)} rETH ≈ ${amt.toPrecision(5)} ETH`,
      valueUsd: p ? r2(amt * p) : null,
      confidence: "high",
      action: "Swap rETH→ETH/USDC on SwapChan (or burn via Rocket Pool when deposit pool has ETH)",
      link: swapUrl(1, RETH, 1, usdcOf(1)!, formatUnits(bal, 18)),
      evidence: [
        ev(1, RETH, "balanceOf(address)", [owner], toHex(bal)),
        ev(1, RETH, "getExchangeRate()", [], toHex(rate as bigint)),
      ],
      underlying: RETH,
    },
  ];
}

// ---------- OP / Arb / Base L2 withdrawal status (detect + explain) ----------
const L2_TO_L1 = "0x4200000000000000000000000000000000000016" as const; // OP Stack MessagePasser

export async function l2Withdrawals(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const out: StuckFound[] = [];
  // Optimism / Base: scan recent MessagePassed from owner via explorer logs is heavy;
  // use public bridge status APIs where available.
  for (const [chainId, name, api] of [
    [10, "Optimism", `https://api-optimistic.etherscan.io/api`],
    [8453, "Base", `https://api.basescan.org/api`],
  ] as const) {
    try {
      const key =
        chainId === 10
          ? (env.OPTIMISM_ETHERSCAN_KEY ?? env.ETHERSCAN_KEY ?? "")
          : (env.BASESCAN_KEY ?? env.ETHERSCAN_KEY ?? "");
      // txlist to L2ToL1MessagePasser from owner
      const url = `${api}?module=account&action=txlist&address=${owner}&sort=desc&page=1&offset=200${key ? `&apikey=${key}` : ""}`;
      const r = await json<{
        result: {
          to: string;
          hash: string;
          timeStamp: string;
          isError: string;
          functionName?: string;
          input: string;
        }[];
      }>(f, url, undefined, 15_000).catch(() => ({ result: [] as never[] }));
      const hits = (Array.isArray(r.result) ? r.result : [])
        .filter(
          (t) =>
            t.to?.toLowerCase() === L2_TO_L1.toLowerCase() &&
            t.isError !== "1" &&
            (t.input?.startsWith("0xc4d66de8") || // initiateWithdrawal-ish
              /withdraw|bridge|prove|finalize/i.test(t.functionName ?? "")),
        )
        .slice(0, 5);
      for (const t of hits) {
        out.push({
          kind: "legacy",
          protocol: `${name} L2→L1 withdrawal`,
          chainId,
          what: `Withdrawal initiated (tx ${t.hash.slice(0, 10)}…) — prove then finalize on L1 after the challenge period`,
          valueUsd: null,
          confidence: "medium",
          action: `Use the official ${name} bridge UI to prove/finalize, or Superchain Relayer; then swap on SwapChan`,
          link:
            chainId === 10
              ? "https://app.optimism.io/bridge/withdraw"
              : "https://bridge.base.org/withdraw",
          evidence: [ev(chainId, L2_TO_L1, "tx", [t.hash], t.input?.slice(0, 66) ?? "0x")],
          risk: "Prove/finalize txs built when L2 receipt + output/game available (see claimTx)",
        });
        // Try building prove/finalize from this initiation tx
        try {
          const { buildOpStackWithdrawalTxs } = await import("./l2bridge.js");
          const built = await buildOpStackWithdrawalTxs(
            env,
            chainId as 10 | 8453,
            t.hash as `0x${string}`,
          );
          if (built.proveTx) {
            out[out.length - 1]!.claimTx = built.proveTx;
            out[out.length - 1]!.what += built.finalizeTx
              ? `; prove+finalize calldata ready (status=${built.status})`
              : `; prove calldata ready (status=${built.status})`;
            out[out.length - 1]!.confidence = "high";
          } else if (built.finalizeTx) {
            out[out.length - 1]!.claimTx = built.finalizeTx;
            out[out.length - 1]!.what += `; finalize calldata ready (status=${built.status})`;
          }
        } catch {}
      }
    } catch {}
  }
  // Arbitrum: Outbox / retryable — detect via arb1 explorer txs to ArbSys (0x64)
  try {
    const ARB_SYS = "0x0000000000000000000000000000000000000064";
    const key = env.ARBISCAN_KEY ?? env.ETHERSCAN_KEY ?? "";
    const url = `https://api.arbiscan.io/api?module=account&action=txlist&address=${owner}&sort=desc&page=1&offset=200${key ? `&apikey=${key}` : ""}`;
    const r = await json<{
      result: { to: string; hash: string; input: string; isError: string; functionName?: string }[];
    }>(f, url, undefined, 15_000).catch(() => ({ result: [] as never[] }));
    const hits = (Array.isArray(r.result) ? r.result : [])
      .filter(
        (t) =>
          t.to?.toLowerCase() === ARB_SYS.toLowerCase() &&
          t.isError !== "1" &&
          (t.input?.startsWith("0x2e567b96") || // withdrawEth
            /withdraw/i.test(t.functionName ?? "")),
      )
      .slice(0, 5);
    for (const t of hits) {
      out.push({
        kind: "legacy",
        protocol: "Arbitrum L2→L1 withdrawal",
        chainId: 42161,
        what: `ArbSys withdrawal (tx ${t.hash.slice(0, 10)}…) — wait ~7 days then execute on L1 Outbox`,
        valueUsd: null,
        confidence: "medium",
        action: "Finalize on bridge.arbitrum.io after the dispute period, then swap on SwapChan",
        link: "https://bridge.arbitrum.io/?destinationChain=ethereum&sourceChain=arbitrum",
        evidence: [ev(42161, ARB_SYS, "tx", [t.hash], t.input?.slice(0, 66) ?? "0x")],
        risk: "L1 Outbox.executeTransaction built via NodeInterface.constructOutboxProof when size/leaf known",
      });
    }
  } catch {}
  void env;
  return out;
}

// ---------- Polygon PoS exits ----------
export async function polygonExits(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  // Detect burns on Polygon that haven't been exited on L1 via Plasma/PoS bridge.
  // Heuristic: recent txs to ERC20Predicate / withdrawTo patterns — use Polygon PoS checkpoint API.
  try {
    const r = await json<{
      result: { to: string; hash: string; input: string; isError: string }[];
    }>(
      f,
      `https://api.polygonscan.com/api?module=account&action=txlist&address=${owner}&sort=desc&page=1&offset=100${env.POLYGONSCAN_KEY ? `&apikey=${env.POLYGONSCAN_KEY}` : env.ETHERSCAN_KEY ? `&apikey=${env.ETHERSCAN_KEY}` : ""}`,
      undefined,
      12_000,
    ).catch(() => ({ result: [] as never[] }));
    const PREDICATE = "0x401F6c983eA34274ec46f84D70b31C151321188b".toLowerCase(); // RootChainManager-ish interactions often via withdraw
    const hits = (Array.isArray(r.result) ? r.result : [])
      .filter(
        (t) =>
          /withdraw|burn/i.test(t.input?.slice(0, 10) ?? "") || t.to?.toLowerCase() === PREDICATE,
      )
      .slice(0, 3);
    return hits.map((t) => ({
      kind: "legacy" as const,
      protocol: "Polygon PoS exit",
      chainId: 137,
      what: `Possible PoS burn/withdraw (tx ${t.hash.slice(0, 10)}…) — exit on wallet.polygon.technology if still pending`,
      valueUsd: null,
      confidence: "low" as const,
      action: "Exit on the Polygon portal after checkpoint, then swap on SwapChan",
      link: "https://wallet.polygon.technology/polygon/bridge/withdraw",
      evidence: [ev(137, t.to || PREDICATE, "tx", [t.hash], t.input?.slice(0, 66) ?? "0x")],
      risk: "Heuristic detection; confirm on Polygon bridge UI",
    }));
  } catch {
    return [];
  }
}

// ---------- Multichain / Celer (detect + explain; often unrecoverable) ----------
const MULTICHAIN_ANYSWAP: Record<number, string> = {
  1: "0x6b7a87899490EcE95443e979cA9485ABF3A4FbF3",
  56: "0xd1C5966f9F5Ee6881Ff6b261BBeDa45972B1B5f3",
  137: "0x4f3Aff3A35fc3107Db93C03950c53D29bE2aE9b1",
};
const CELER_BRIDGE: Record<number, string> = {
  1: "0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820",
  56: "0xdd90E5E87A208a2a1bBF295a1d4050D9f564dBf2",
  42161: "0x1619DE6B6B20eD217a58d00f37B9d47C7663feca",
  10: "0x9D39Fc627A6d9d9F8C831C16995b209548cc3401",
};

export async function multichainCeler(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const out: StuckFound[] = [];
  for (const [id, addr] of Object.entries(MULTICHAIN_ANYSWAP)) {
    const chainId = Number(id);
    const c = evmClient(chainId, env);
    // any tokens left? Multichain is largely insolvent — flag interaction history via explorer
    try {
      const ex =
        chainId === 1
          ? `https://api.etherscan.io/api`
          : chainId === 56
            ? `https://api.bscscan.com/api`
            : `https://api.polygonscan.com/api`;
      const r = await json<{ result: { to: string; hash: string; isError: string }[] }>(
        f,
        `${ex}?module=account&action=txlist&address=${owner}&sort=desc&page=1&offset=50`,
        undefined,
        10_000,
      ).catch(() => ({ result: [] as never[] }));
      const hit = (Array.isArray(r.result) ? r.result : []).find(
        (t) => t.to?.toLowerCase() === addr.toLowerCase() && t.isError !== "1",
      );
      if (hit) {
        out.push({
          kind: "legacy",
          protocol: "Multichain (Anyswap) — likely unrecoverable",
          chainId,
          what: `Wallet interacted with Multichain router ${addr.slice(0, 8)}… (tx ${hit.hash.slice(0, 10)}…). Protocol collapsed; funds may be lost.`,
          valueUsd: null,
          confidence: "low",
          action:
            "Check official Multichain recovery claims if any remain; otherwise treat as loss",
          link: `${SITE}/find-money/guide`,
          evidence: [ev(chainId, addr, "tx", [hit.hash], "0x")],
          risk: "Impossible to auto-recover: Multichain validators/MPC are gone. Detection only.",
        });
      }
    } catch {}
    void c;
  }
  for (const [id, addr] of Object.entries(CELER_BRIDGE)) {
    const chainId = Number(id);
    try {
      // cbridge transfer history API (keyless)
      const r = await json<{
        err: string;
        transfer?: { status: string; dst_tx_hash?: string; src_amount?: string; token?: string }[];
      }>(
        f,
        `https://cbridge-prod2.celer.network/v2/getTransferStatus?transfer_id=0&addr=${owner}`,
        undefined,
        10_000,
      ).catch(() => null);
      // Alternate: search txs to cbridge
      void r;
      const exUrl =
        chainId === 1
          ? "https://api.etherscan.io/api"
          : chainId === 42161
            ? "https://api.arbiscan.io/api"
            : chainId === 10
              ? "https://api-optimistic.etherscan.io/api"
              : "https://api.bscscan.com/api";
      const tx = await json<{ result: { to: string; hash: string; isError: string }[] }>(
        f,
        `${exUrl}?module=account&action=txlist&address=${owner}&sort=desc&page=1&offset=40`,
        undefined,
        10_000,
      ).catch(() => ({ result: [] as never[] }));
      const hit = (Array.isArray(tx.result) ? tx.result : []).find(
        (t) => t.to?.toLowerCase() === addr.toLowerCase(),
      );
      if (hit) {
        out.push({
          kind: "legacy",
          protocol: "Celer cBridge",
          chainId,
          what: `Prior cBridge interaction (tx ${hit.hash.slice(0, 10)}…). Check cbridge.celer.network for pending refunds.`,
          valueUsd: null,
          confidence: "low",
          action: "Open Celer explorer / refund portal; complete refund manually if pending",
          link: "https://cbridge.celer.network/",
          evidence: [ev(chainId, addr, "tx", [hit.hash], "0x")],
          risk: "Manual: refunds need Celer's refund flow; SwapChan detects history only",
        });
      }
    } catch {}
  }
  return out;
}

// ---------- merkle airdrops (UNI / ENS / 1INCH / OP / ARB): see merkleClaims.ts ----------
export async function merkleAirdrops(
  f: typeof fetch,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const { merkleClaimFromTrees } = await import("./merkleClaims.js");
  return merkleClaimFromTrees(f, env, owner).catch(() => []);
}

// ---------- Uni v2 removeLiquidity tx builder ----------
export async function uniV2RemoveLiquidityTx(
  env: NodeJS.ProcessEnv,
  chainId: number,
  pair: `0x${string}`,
  owner: `0x${string}`,
  liquidity: bigint,
  token0: `0x${string}`,
  token1: `0x${string}`,
  /** expected amounts out from live reserves (reserve * liquidity / totalSupply); required: no quote, no tx */
  quoted?: readonly [bigint, bigint],
): Promise<StuckFound["claimTx"]> {
  if (!quoted || (quoted[0] === 0n && quoted[1] === 0n)) return undefined;
  // Prefer router removeLiquidity; routers per chain
  const ROUTER: Record<number, `0x${string}`> = {
    1: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    8453: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
    10: "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2",
    42161: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
    137: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
    56: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  };
  const router = ROUTER[chainId];
  if (!router) return undefined;
  const deadline = exitDeadline();
  // Note: needs prior approve(pair→router). We build removeLiquidity; agent must approve first.
  return {
    chainId,
    to: router,
    data: encodeFunctionData({
      abi: fn("removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)"),
      functionName: "removeLiquidity",
      args: [token0, token1, liquidity, minOut(quoted[0]), minOut(quoted[1]), owner, deadline],
    }),
    value: "0",
    description: `removeLiquidity: burn LP ${pair.slice(0, 8)}… (approve router first)`,
  };
}

// ---------- BTC xpub → derived addresses → UTXO set (read-only) ----------
export async function btcXpubScan(f: F, xpubOrAddr: string): Promise<StuckFound[]> {
  // blockchain.info multiaddr supports xpub; also plain addresses
  const active = encodeURIComponent(xpubOrAddr.trim());
  const r = await json<{
    wallet?: { final_balance: number };
    addresses?: { address: string; final_balance: number; n_tx: number }[];
    txs?: unknown[];
  }>(f, `https://blockchain.info/multiaddr?active=${active}&n=50`, undefined, 20_000).catch(
    () => null,
  );
  if (!r?.addresses?.length && !r?.wallet) {
    // fallback single address via mempool.space
    if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(xpubOrAddr)) {
      const u = await json<{ chain_stats: { funded_txo_sum: number; spent_txo_sum: number } }>(
        f,
        `https://mempool.space/api/address/${xpubOrAddr}`,
        undefined,
        10_000,
      ).catch(() => null);
      if (!u) return [];
      const sats = u.chain_stats.funded_txo_sum - u.chain_stats.spent_txo_sum;
      if (sats <= 0) return [];
      const btc = sats / 1e8;
      const BTC_NATIVE = "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8";
      const px = await prices(f, [
        { chainId: BITCOIN, address: BTC_NATIVE },
        { chainId: BITCOIN, address: "btc" },
      ]).catch(() => new Map());
      const btcP = pxOf(px, BITCOIN, BTC_NATIVE)?.price ?? pxOf(px, BITCOIN, "btc")?.price ?? null;
      return [
        {
          kind: "claimable",
          protocol: "Bitcoin UTXO",
          chainId: BITCOIN,
          what: `${btc} BTC across UTXOs at ${xpubOrAddr.slice(0, 12)}…`,
          valueUsd: btcP ? r2(btc * btcP) : null,
          confidence: "high",
          action: "Spend via your wallet / SwapChan BTC route (PSBT)",
          link: `${SITE}/?fromChain=${BITCOIN}&fromToken=btc`,
          evidence: [ev(BITCOIN, xpubOrAddr, "mempool.space/address", [], String(sats))],
        },
      ];
    }
    return [];
  }
  const addrs = (r.addresses ?? []).filter((a) => a.final_balance > 0);
  const totalSats = r.wallet?.final_balance ?? addrs.reduce((s, a) => s + a.final_balance, 0);
  if (totalSats <= 0) return [];
  const btc = totalSats / 1e8;
  const BTC_NATIVE = "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8";
  const px = await prices(f, [
    { chainId: BITCOIN, address: BTC_NATIVE },
    { chainId: BITCOIN, address: "btc" },
  ]).catch(() => new Map());
  const btcP = pxOf(px, BITCOIN, BTC_NATIVE)?.price ?? pxOf(px, BITCOIN, "btc")?.price ?? null;
  return [
    {
      kind: "claimable",
      protocol:
        xpubOrAddr.startsWith("xpub") ||
        xpubOrAddr.startsWith("ypub") ||
        xpubOrAddr.startsWith("zpub")
          ? "Bitcoin xpub scan"
          : "Bitcoin UTXO",
      chainId: BITCOIN,
      what: `${btc} BTC across ${addrs.length || "?"} funded address(es)`,
      valueUsd: btcP ? r2(btc * btcP) : null,
      confidence: "high",
      action: "Use your wallet to spend; SwapChan can build a PSBT for a bc1q sender",
      link: `${SITE}/?fromChain=${BITCOIN}`,
      evidence: addrs
        .slice(0, 20)
        .map((a) => ev(BITCOIN, a.address, "final_balance", [], String(a.final_balance))),
    },
  ];
}

// ---------- HEX stakes (late-end penalty) ----------
const HEX = "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39" as const;
/** HEX late penalty: after lockedDay+stakedDays+14 grace days, 1/700 of the stake per late day. */
export function hexLatePenalty(hearts: bigint, lateDays: number): bigint {
  const over = BigInt(Math.max(0, lateDays - 14));
  if (over >= 700n) return hearts;
  return (hearts * over) / 700n;
}
export async function hexStakes(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const c = evmClient(1, env);
  const n = Number(
    await c.readContract({
      address: HEX,
      abi: fn("stakeCount(address) view returns (uint256)"),
      functionName: "stakeCount",
      args: [owner],
    }),
  );
  if (!n) return [];
  const today = Number(
    await c.readContract({
      address: HEX,
      abi: fn("currentDay() view returns (uint256)"),
      functionName: "currentDay",
    }),
  );
  const [px, ethPx, gas] = await Promise.all([
    prices(f, [
      { chainId: 1, address: HEX },
      { chainId: 1, address: NATIVE_TOKEN },
    ]),
    Promise.resolve(null),
    c.getGasPrice(),
  ]);
  void ethPx;
  const hexUsd = pxOf(px, 1, HEX)?.price ?? null;
  const ethUsd = pxOf(px, 1, NATIVE_TOKEN)?.price ?? null;
  const gasUsd = ethUsd === null ? null : (Number(gas) * 80_000 * ethUsd) / 1e18;
  const out: StuckFound[] = [];
  for (let i = 0; i < Math.min(n, 50); i++) {
    const s = (await c.readContract({
      address: HEX,
      abi: fn(
        "stakeLists(address,uint256) view returns (uint40 stakeId, uint72 stakedHearts, uint72 stakeShares, uint16 lockedDay, uint16 stakedDays, uint16 unlockedDay, bool isAutoStake)",
      ),
      functionName: "stakeLists",
      args: [owner, BigInt(i)],
    })) as readonly [number, bigint, bigint, number, number, number, boolean];
    const [stakeId, hearts, , lockedDay, stakedDays] = s;
    const endDay = lockedDay + stakedDays;
    const late = today - endDay;
    const principal = Number(hearts) / 1e8;
    const pen = late > 0 ? hexLatePenalty(hearts, late) : 0n;
    const left = Number(hearts - pen) / 1e8;
    const leftUsd = hexUsd === null ? null : r2(left * hexUsd);
    const status =
      today < endDay
        ? `still locked until day ${endDay} (today ${today}); ending early costs an emergency-end penalty`
        : late <= 14
          ? `matured day ${endDay}; inside the 14-day grace, no penalty yet`
          : `matured day ${endDay}, ${late} days ago; late penalty ${Math.min(late - 14, 700)}/700 of the stake${late - 14 >= 700 ? " (100%, capped)" : ""} = ${(Number(pen) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 })} HEX`;
    const worth =
      today >= endDay && left > 0 && leftUsd !== null && gasUsd !== null && leftUsd > gasUsd * 1.5;
    out.push({
      kind: worth ? "claimable" : "lead",
      protocol: "HEX stake",
      chainId: 1,
      what: `HEX stake #${stakeId}: ${principal.toLocaleString("en-US", { maximumFractionDigits: 2 })} HEX staked day ${lockedDay} for ${stakedDays} days; ${status}. Principal left after penalty ≈ ${left.toLocaleString("en-US", { maximumFractionDigits: 2 })} HEX${leftUsd !== null ? ` ($${leftUsd})` : ""} (estimate: excludes accrued yield, which the same penalty also cuts)`,
      valueUsd: worth ? leftUsd : null,
      ...(worth
        ? {
            claimTx: {
              chainId: 1,
              to: HEX,
              data: encodeFunctionData({
                abi: fn("stakeEnd(uint256 stakeIndex, uint40 stakeIdParam)"),
                functionName: "stakeEnd",
                args: [BigInt(i), stakeId],
              }),
              value: "0",
              description: `HEX stakeEnd(${i}, ${stakeId}): returns principal + yield minus late penalty to you`,
            },
          }
        : {}),
      action: worth
        ? "Sign stakeEnd to pull what's left, then swap on SwapChan"
        : left <= 0
          ? "Nothing recoverable: the late penalty has consumed the whole stake"
          : today < endDay
            ? "Not recoverable yet without an early-end penalty"
            : `Not worth ending: what's left is below the ~$${gasUsd === null ? "?" : r2(gasUsd)} gas cost`,
      ...(worth ? {} : { risk: "Lead only, not counted in the total" }),
      link: `https://etherscan.io/address/${HEX}#readContract`,
      evidence: [ev(1, HEX, "stakeLists(address,uint256)", [owner, String(i)], s.map(String))],
    });
  }
  return out;
}

/** Run all known-registry stuck-money detectors for an EVM owner. */
export async function stuckMoneyRegistry(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<StuckFound[]> {
  const parts = await Promise.all([
    curveConvex(f, env, owner).catch(() => []),
    synthetixStuck(f, env, owner).catch(() => []),
    sablierStuck(f, env, owner).catch(() => []),
    pendleStuck(f, env, owner).catch(() => []),
    gmxStuck(f, env, owner).catch(() => []),
    rocketPoolStuck(f, env, owner).catch(() => []),
    l2Withdrawals(f, env, owner).catch(() => []),
    polygonExits(f, env, owner).catch(() => []),
    multichainCeler(f, env, owner).catch(() => []),
    merkleAirdrops(f, env, owner).catch(() => []),
    hexStakes(f, env, owner).catch(() => []),
  ]);
  return parts.flat();
}
