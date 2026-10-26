/**
 * Token locks and streams where this wallet is the beneficiary:
 *  - Hedgey vesting/lockup plan NFTs (same CREATE2 addresses on every chain) → redeemPlans([ids])
 *  - Team Finance LockToken (Ethereum) → withdrawTokens(id) once unlocked
 *  - UNCX (Unicrypt) Uniswap v2 LP locker (Ethereum) → withdraw(lp, index, lockID, amount) once unlocked
 *  - Superfluid Super Token balances (incoming streams accumulate there) → downgrade / downgradeToETH
 * Every tx is simulated from the owner before it is offered. Each chain/source fails into its own "not checked" line.
 */
import { formatUnits, getAddress, parseAbi } from "viem";
import { encodeFunctionData } from "./blocktools.js";
import type { Found } from "./intel.js";
import { chainName, evmClient, json, prices, pxOf, swapUrl, usdcOf } from "./onchain.js";

type F = typeof fetch;
type Out = { items: Found[]; notChecked: string[] };
const r2 = (n: number) => Math.round(n * 100) / 100;
const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const now = () => BigInt(Math.floor(Date.now() / 1000));

async function meta(c: ReturnType<typeof evmClient>, t: `0x${string}`) {
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address: t, abi: ERC20, functionName: "symbol" }).catch(() => "?"),
    c.readContract({ address: t, abi: ERC20, functionName: "decimals" }).catch(() => 18),
  ]);
  return { symbol: String(symbol), decimals: Number(decimals) };
}
async function sim(
  c: ReturnType<typeof evmClient>,
  owner: `0x${string}`,
  to: `0x${string}`,
  data: `0x${string}`,
) {
  return c.call({ account: owner, to, data }).then(
    () => true,
    () => false,
  );
}

// ---------- Hedgey ----------
const HEDGEY: { addr: `0x${string}`; name: string }[] = [
  { addr: "0x2CDE9919e81b20B4B33DD562a48a84b54C48F00C", name: "Hedgey vesting plan" },
  { addr: "0x1bb64AF7FE05fc69c740609267d2AbE3e119Ef82", name: "Hedgey voting vesting plan" },
  { addr: "0x1961A23409CA59EEDCA6a99c97E4087DaD752486", name: "Hedgey lockup plan" },
  { addr: "0x73cD8626b3cD47B009E68380720CFE6679A3Ec3D", name: "Hedgey voting lockup plan" },
  { addr: "0xA600EC7Db69DFCD21f19face5B209a55EAb7a7C0", name: "Hedgey bound lockup plan" },
];
const HABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function plans(uint256) view returns (address,uint256,uint256,uint256,uint256,uint256)",
  "function planBalanceOf(uint256,uint256,uint256) view returns (uint256,uint256,uint256)",
  "function redeemPlans(uint256[])",
]);
const HEDGEY_CHAINS = [1, 8453, 42161, 10, 137, 56, 43114, 59144];

async function hedgeyChain(
  f: F,
  env: NodeJS.ProcessEnv,
  chainId: number,
  owner: `0x${string}`,
): Promise<Found[]> {
  const c = evmClient(chainId, env);
  const out: Found[] = [];
  await Promise.all(
    HEDGEY.map(async (h) => {
      const code = await c.getCode({ address: h.addr });
      if (!code || code === "0x") return;
      const n = Number(
        await c.readContract({
          address: h.addr,
          abi: HABI,
          functionName: "balanceOf",
          args: [owner],
        }),
      );
      if (!n) return;
      const ids = await Promise.all(
        Array.from({ length: Math.min(n, 30) }, (_, i) =>
          c.readContract({
            address: h.addr,
            abi: HABI,
            functionName: "tokenOfOwnerByIndex",
            args: [owner, BigInt(i)],
          }),
        ),
      );
      const t = now();
      const rows = await Promise.all(
        ids.map(async (id) => {
          const [p, b] = await Promise.all([
            c.readContract({ address: h.addr, abi: HABI, functionName: "plans", args: [id] }),
            c.readContract({
              address: h.addr,
              abi: HABI,
              functionName: "planBalanceOf",
              args: [id, t, t],
            }),
          ]);
          return { id, token: getAddress(p[0]), now: b[0], locked: b[1], next: Number(b[2]) };
        }),
      );
      const byTok = new Map<string, typeof rows>();
      for (const r of rows) byTok.set(r.token, [...(byTok.get(r.token) ?? []), r]);
      const px = await prices(
        f,
        [...byTok.keys()].map((a) => ({ chainId, address: a })),
      ).catch(() => new Map());
      for (const [token, rs] of byTok) {
        const m = await meta(c, token as `0x${string}`);
        const p = pxOf(px, chainId, token)?.price ?? null;
        const ready = rs.filter((r) => r.now > 0n);
        const sumNow = ready.reduce((a, r) => a + r.now, 0n),
          sumLocked = rs.reduce((a, r) => a + r.locked, 0n);
        const nNow = Number(formatUnits(sumNow, m.decimals)),
          nLocked = Number(formatUnits(sumLocked, m.decimals));
        const ev = rs.map((r) => ({
          chainId,
          address: h.addr,
          call: "planBalanceOf(uint256,uint256,uint256)",
          args: [String(r.id), String(t), String(t)],
          raw: `${r.now}/${r.locked}`,
        }));
        if (ready.length) {
          const data = encodeFunctionData({
            abi: HABI,
            functionName: "redeemPlans",
            args: [ready.map((r) => r.id)],
          });
          const ok = await sim(c, owner, h.addr, data);
          out.push({
            kind: "claimable",
            protocol: h.name,
            chainId,
            what: `${nNow.toPrecision(6)} ${m.symbol} unlocked now across ${ready.length} plan(s) on ${chainName(chainId)}${nLocked > 0 ? `; ${nLocked.toPrecision(6)} still vesting` : ""}`,
            valueUsd: p ? r2(nNow * p) : null,
            ...(ok
              ? {
                  claimTx: {
                    chainId,
                    to: h.addr,
                    data,
                    value: "0",
                    description: `Hedgey redeemPlans([${ready.map((r) => r.id).join(",")}]) → your wallet`,
                  },
                }
              : {}),
            action: ok
              ? `Sign redeemPlans, then swap ${m.symbol} on SwapChan`
              : "Redeem simulation reverted; no tx offered",
            link: swapUrl(chainId, token, chainId, usdcOf(chainId) ?? token, String(nNow)),
            underlying: token,
            evidence: ev,
            confidence: "high",
          } as Found);
        } else if (sumLocked > 0n) {
          const next = Math.min(...rs.map((r) => r.next).filter((x) => x > 0));
          out.push({
            kind: "lead",
            protocol: h.name,
            chainId,
            what: `${nLocked.toPrecision(6)} ${m.symbol} still vesting in ${rs.length} plan(s) on ${chainName(chainId)}${Number.isFinite(next) ? `; next unlock ${new Date(next * 1000).toISOString().slice(0, 10)}` : ""}`,
            valueUsd: p ? r2(nLocked * p) : null,
            action: "Nothing redeemable yet; no tx until it unlocks",
            underlying: token,
            evidence: ev,
          } as Found);
        }
      }
    }),
  );
  return out;
}

export async function hedgeyPlans(f: F, env: NodeJS.ProcessEnv, owner: string): Promise<Out> {
  const own = getAddress(owner);
  const notChecked: string[] = [];
  const res = await Promise.all(
    HEDGEY_CHAINS.map((id) =>
      Promise.race([
        hedgeyChain(f, env, id, own),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 9_000)),
      ]).catch(
        (e) => (
          notChecked.push(
            `Hedgey on ${chainName(id)}: not checked (${String((e as Error).message).slice(0, 50)})`,
          ),
          [] as Found[]
        ),
      ),
    ),
  );
  return { items: res.flat(), notChecked };
}

// ---------- Team Finance ----------
const TEAM = "0xE2fE530C047f2d85298b07D9333C05737f1435fB" as const;
const TABI = parseAbi([
  "function getDepositsByWithdrawalAddress(address) view returns (uint256[])",
  "function lockedToken(uint256) view returns (address,address,uint256,uint256,bool)",
  "function withdrawTokens(uint256)",
]);
export async function teamFinanceLocks(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: string,
): Promise<Found[]> {
  const own = getAddress(owner),
    c = evmClient(1, env);
  const ids = (
    await c.readContract({
      address: TEAM,
      abi: TABI,
      functionName: "getDepositsByWithdrawalAddress",
      args: [own],
    })
  ).slice(-40);
  const locks = await Promise.all(
    ids.map(async (id) => ({
      id,
      l: await c.readContract({
        address: TEAM,
        abi: TABI,
        functionName: "lockedToken",
        args: [id],
      }),
    })),
  );
  const open = locks.filter((x) => !x.l[4] && x.l[2] > 0n && getAddress(x.l[1]) === own);
  const px = await prices(
    f,
    open.map((x) => ({ chainId: 1, address: getAddress(x.l[0]) })),
  ).catch(() => new Map());
  const t = Number(now());
  return Promise.all(
    open.map(async ({ id, l }) => {
      const token = getAddress(l[0]),
        m = await meta(c, token),
        n = Number(formatUnits(l[2], m.decimals));
      const p = pxOf(px, 1, token)?.price ?? null,
        unlocked = Number(l[3]) <= t;
      const data = encodeFunctionData({ abi: TABI, functionName: "withdrawTokens", args: [id] });
      const ok = unlocked && (await sim(c, own, TEAM, data));
      const ev = [
        {
          chainId: 1,
          address: TEAM,
          call: "lockedToken(uint256)",
          args: [String(id)],
          raw: `${l[2]} unlock=${l[3]}`,
        },
      ];
      return (
        unlocked
          ? {
              kind: "claimable",
              protocol: "Team Finance lock",
              chainId: 1,
              what: `lock #${id}: ${n.toPrecision(6)} ${m.symbol} unlocked since ${new Date(Number(l[3]) * 1000).toISOString().slice(0, 10)}`,
              valueUsd: p ? r2(n * p) : null,
              ...(ok
                ? {
                    claimTx: {
                      chainId: 1,
                      to: TEAM,
                      data,
                      value: "0",
                      description: `Team Finance withdrawTokens(${id}) → your wallet`,
                    },
                  }
                : {}),
              action: ok
                ? `Sign withdrawTokens, then swap ${m.symbol} on SwapChan`
                : "Withdraw simulation reverted; no tx offered",
              link: swapUrl(1, token, 1, usdcOf(1)!, String(n)),
              underlying: token,
              evidence: ev,
              confidence: "high",
            }
          : {
              kind: "lead",
              protocol: "Team Finance lock",
              chainId: 1,
              what: `lock #${id}: ${n.toPrecision(6)} ${m.symbol} locked until ${new Date(Number(l[3]) * 1000).toISOString().slice(0, 10)}`,
              valueUsd: p ? r2(n * p) : null,
              action: "Still locked; no tx until the unlock date",
              underlying: token,
              evidence: ev,
            }
      ) as Found;
    }),
  );
}

// ---------- UNCX (Unicrypt) Uniswap v2 locker ----------
const UNCX = "0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214" as const;
const UABI = parseAbi([
  "function getUserNumLockedTokens(address) view returns (uint256)",
  "function getUserLockedTokenAtIndex(address,uint256) view returns (address)",
  "function getUserNumLocksForToken(address,address) view returns (uint256)",
  "function getUserLockForTokenAtIndex(address,address,uint256) view returns (uint256,uint256,uint256,uint256,uint256,address)",
  "function getNumLocksForToken(address) view returns (uint256)",
  "function tokenLocks(address,uint256) view returns (uint256,uint256,uint256,uint256,uint256,address)",
  "function withdraw(address,uint256,uint256,uint256)",
]);
export async function uncxLocks(f: F, env: NodeJS.ProcessEnv, owner: string): Promise<Found[]> {
  const own = getAddress(owner),
    c = evmClient(1, env);
  const nT = Number(
    await c.readContract({
      address: UNCX,
      abi: UABI,
      functionName: "getUserNumLockedTokens",
      args: [own],
    }),
  );
  if (!nT) return [];
  const lps = await Promise.all(
    Array.from({ length: Math.min(nT, 20) }, (_, i) =>
      c.readContract({
        address: UNCX,
        abi: UABI,
        functionName: "getUserLockedTokenAtIndex",
        args: [own, BigInt(i)],
      }),
    ),
  );
  const t = Number(now()),
    out: Found[] = [];
  await Promise.all(
    lps.map(async (lp) => {
      const k = Number(
        await c.readContract({
          address: UNCX,
          abi: UABI,
          functionName: "getUserNumLocksForToken",
          args: [own, lp],
        }),
      );
      const mine = await Promise.all(
        Array.from({ length: Math.min(k, 10) }, (_, i) =>
          c.readContract({
            address: UNCX,
            abi: UABI,
            functionName: "getUserLockForTokenAtIndex",
            args: [own, lp, BigInt(i)],
          }),
        ),
      );
      const m = await meta(c, lp);
      for (const l of mine.filter((x) => x[1] > 0n)) {
        const n = Number(formatUnits(l[1], m.decimals)),
          unlocked = Number(l[3]) <= t,
          lockID = l[4];
        const ev = [
          {
            chainId: 1,
            address: UNCX,
            call: "getUserLockForTokenAtIndex(address,address,uint256)",
            args: [own, lp],
            raw: `${l[1]} unlock=${l[3]} id=${lockID}`,
          },
        ];
        if (!unlocked) {
          out.push({
            kind: "lead",
            protocol: "UNCX LP lock",
            chainId: 1,
            what: `lock ${lockID}: ${n.toPrecision(6)} ${m.symbol} LP (${lp.slice(0, 10)}…) locked until ${new Date(Number(l[3]) * 1000).toISOString().slice(0, 10)}`,
            valueUsd: null,
            action: "Still locked; no tx until the unlock date",
            evidence: ev,
          } as Found);
          continue;
        }
        // withdraw() wants the index in the global tokenLocks[lp] array
        const total = Number(
          await c.readContract({
            address: UNCX,
            abi: UABI,
            functionName: "getNumLocksForToken",
            args: [lp],
          }),
        );
        const all = await Promise.all(
          Array.from({ length: Math.min(total, 200) }, (_, i) =>
            c
              .readContract({
                address: UNCX,
                abi: UABI,
                functionName: "tokenLocks",
                args: [lp, BigInt(i)],
              })
              .then((x) => ({ i, x })),
          ),
        );
        const idx = all.find((y) => y.x[4] === lockID)?.i;
        const data =
          idx === undefined
            ? null
            : encodeFunctionData({
                abi: UABI,
                functionName: "withdraw",
                args: [lp, BigInt(idx), lockID, l[1]],
              });
        const ok = !!data && (await sim(c, own, UNCX, data));
        out.push({
          kind: "claimable",
          protocol: "UNCX LP lock",
          chainId: 1,
          what: `lock ${lockID}: ${n.toPrecision(6)} ${m.symbol} LP (${lp.slice(0, 10)}…) unlocked since ${new Date(Number(l[3]) * 1000).toISOString().slice(0, 10)}`,
          valueUsd: null,
          ...(ok
            ? {
                claimTx: {
                  chainId: 1,
                  to: UNCX,
                  data: data!,
                  value: "0",
                  description: `UNCX withdraw(lock ${lockID}) → LP tokens to your wallet`,
                },
              }
            : {}),
          action: ok
            ? "Sign withdraw, then remove liquidity and swap on SwapChan"
            : "Withdraw could not be built or simulated; no tx offered",
          underlying: lp,
          evidence: ev,
          confidence: "high",
        } as Found);
      }
    }),
  );
  return out;
}

// ---------- Superfluid ----------
const SF_NET: Record<number, string> = {
  1: "eth-mainnet",
  8453: "base-mainnet",
  10: "optimism-mainnet",
  42161: "arbitrum-one",
  137: "polygon-mainnet",
  43114: "avalanche-c",
  56: "bsc-mainnet",
};
const SABI = parseAbi([
  "function realtimeBalanceOfNow(address) view returns (int256,uint256,uint256,uint256)",
  "function downgrade(uint256)",
  "function downgradeToETH(uint256)",
]);
type Snap = {
  token: {
    id: string;
    symbol: string;
    underlyingAddress: string;
    decimals: number;
    isNativeAssetSuperToken: boolean;
  };
  totalNetFlowRate: string;
  totalInflowRate?: string;
};
export async function superfluidBalances(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: string,
): Promise<Out> {
  const own = getAddress(owner),
    me = own.toLowerCase(),
    notChecked: string[] = [];
  const res = await Promise.all(
    Object.entries(SF_NET).map(async ([cid, net]) => {
      const chainId = Number(cid);
      try {
        const q = `{ accountTokenSnapshots(first: 50, where: { account: "${me}" }) { token { id symbol underlyingAddress decimals isNativeAssetSuperToken } totalNetFlowRate } }`;
        const r = await json<{
          data?: { accountTokenSnapshots: Snap[] };
          errors?: { message: string }[];
        }>(
          f,
          `https://subgraph-endpoints.superfluid.dev/${net}/protocol-v1`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: q }),
          },
          8_000,
        );
        if (r.errors?.length) throw new Error(r.errors[0]!.message.slice(0, 50));
        const snaps = r.data?.accountTokenSnapshots ?? [];
        if (!snaps.length) return [] as Found[];
        const c = evmClient(chainId, env);
        const rows = await Promise.all(
          snaps.map(async (s) => ({
            s,
            b: await c
              .readContract({
                address: getAddress(s.token.id),
                abi: SABI,
                functionName: "realtimeBalanceOfNow",
                args: [own],
              })
              .catch(() => null),
          })),
        );
        const live = rows.filter((x) => x.b && x.b[0] > 0n);
        const und = (s: Snap) =>
          s.token.isNativeAssetSuperToken
            ? "0x0000000000000000000000000000000000000000"
            : s.token.underlyingAddress;
        const px = await prices(
          f,
          live.map((x) => ({
            chainId,
            address: getAddress(
              und(x.s) === "0x0000000000000000000000000000000000000000" &&
                !x.s.token.isNativeAssetSuperToken
                ? x.s.token.id
                : und(x.s),
            ),
          })),
        ).catch(() => new Map());
        return Promise.all(
          live.map(async ({ s, b }) => {
            const st = getAddress(s.token.id),
              amt = b![0],
              n = Number(formatUnits(amt, s.token.decimals));
            const native = s.token.isNativeAssetSuperToken,
              wrapper = !native && BigInt(s.token.underlyingAddress) !== 0n;
            const underlying = native
              ? "0x0000000000000000000000000000000000000000"
              : wrapper
                ? getAddress(s.token.underlyingAddress)
                : st;
            const p = pxOf(px, chainId, underlying)?.price ?? null;
            const streaming = BigInt(s.totalNetFlowRate) !== 0n;
            // leave the stream's buffer alone: downgrading the full balance of an account with an outgoing stream would liquidate it
            const data =
              native || wrapper
                ? encodeFunctionData({
                    abi: SABI,
                    functionName: native ? "downgradeToETH" : "downgrade",
                    args: [amt],
                  })
                : null;
            const ok = !!data && BigInt(s.totalNetFlowRate) >= 0n && (await sim(c, own, st, data));
            const ev = [
              {
                chainId,
                address: st,
                call: "realtimeBalanceOfNow(address)",
                args: [own],
                raw: String(amt),
              },
            ];
            return {
              kind: data ? "claimable" : "lead",
              protocol: `Superfluid ${s.token.symbol}`,
              chainId,
              what: `${n.toPrecision(6)} ${s.token.symbol} in Superfluid on ${chainName(chainId)}${streaming ? " (stream active, balance still changing)" : ""}${!data ? " (pure Super Token, no underlying to unwrap)" : ""}`,
              valueUsd: p ? r2(n * p) : null,
              ...(ok
                ? {
                    claimTx: {
                      chainId,
                      to: st,
                      data: data!,
                      value: "0",
                      description: `Superfluid ${native ? "downgradeToETH" : "downgrade"}(${amt}) → ${native ? "native coin" : "underlying token"}`,
                    },
                  }
                : {}),
              action: ok
                ? "Sign the unwrap, then swap on SwapChan"
                : data
                  ? "Unwrap not offered (outgoing stream or simulation reverted)"
                  : "Swap the Super Token directly if a route exists",
              link: swapUrl(chainId, underlying, chainId, usdcOf(chainId) ?? underlying, String(n)),
              underlying,
              evidence: ev,
              confidence: "high",
            } as Found;
          }),
        );
      } catch (e) {
        notChecked.push(
          `Superfluid on ${chainName(chainId)}: not checked (${String((e as Error).message).slice(0, 50)})`,
        );
        return [] as Found[];
      }
    }),
  );
  return { items: res.flat(), notChecked };
}
