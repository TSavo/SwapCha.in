import { formatUnits, parseAbiItem } from "viem";
import { callMany, SEL } from "./balscan.js";
import { encodeFunctionData } from "./blocktools.js";
import { evmClient, prices, pxOf } from "./onchain.js";
import type { NewFound } from "./recover.js";
import { cached } from "./scanner.js";

/** LP staked in Curve gauges (full Curve gauge list, 7 chains), Convex and Aura reward pools. Exact on-chain balances;
 *  USD from Curve's lpTokenPrice (Curve/Convex) or DefiLlama (Aura BPT). Exit tx: gauge.withdraw(bal) /
 *  rewardPool.withdrawAndUnwrap(bal, true) — both pay msg.sender only. */
type F = typeof fetch;
const CHAIN: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  polygon: 137,
  base: 8453,
  bsc: 56,
  optimism: 10,
  avalanche: 43114,
};
const BAL = parseAbiItem("function balanceOf(address) view returns (uint256)");
const EARNED = parseAbiItem("function earned(address) view returns (uint256)");
const POOL_INFO = parseAbiItem(
  "function poolInfo(uint256) view returns (address lptoken,address token,address gauge,address crvRewards,address stash,bool shutdown)",
);
const BOOSTERS = [
  {
    name: "Convex",
    chainId: 1,
    addr: "0xF403C135812408BFbE8713b5A23a04b3D48AAE31" as const,
    reward: { sym: "CRV", addr: "0xD533a949740bb3306d119CC777fa900bA034cd52" },
  },
  {
    name: "Aura",
    chainId: 1,
    addr: "0xA57b8d98dAE62B26Ec3bcC4a365338157060B234" as const,
    reward: { sym: "BAL", addr: "0xba100000625a3754423978a60c9317c58a424e3D" },
  },
];
type G = { gauge: string; lp: string; name: string; px: number | null; chainId: number };

export const gaugeWithdrawTx = (chainId: number, gauge: string, amt: bigint, name: string) => ({
  chainId,
  to: gauge,
  value: "0",
  data: encodeFunctionData({ abi: [parseAbiItem("function withdraw(uint256)")], args: [amt] }),
  description: `Unstake ${name} LP from its Curve gauge to your wallet`,
});
export const rewardPoolExitTx = (chainId: number, pool: string, amt: bigint, name: string) => ({
  chainId,
  to: pool,
  value: "0",
  data: encodeFunctionData({
    abi: [parseAbiItem("function withdrawAndUnwrap(uint256,bool)")],
    args: [amt, true],
  }),
  description: `Withdraw ${name} LP and claim rewards to your wallet`,
});

async function curveGauges(f: F): Promise<G[]> {
  return cached("curve:gauges", 6 * 3600_000, async () => {
    const r = (await (
      await f("https://api.curve.finance/api/getAllGauges", { signal: AbortSignal.timeout(8000) })
    ).json()) as { data: Record<string, any> };
    return Object.values(r.data)
      .filter((g) => CHAIN[g.blockchainId] && g.gauge && !g.is_killed)
      .map((g) => ({
        gauge: g.gauge,
        lp: String(g.swap_token ?? ""),
        name: String(g.shortName ?? g.name ?? "Curve"),
        px: typeof g.lpTokenPrice === "number" ? g.lpTokenPrice : null,
        chainId: CHAIN[g.blockchainId]!,
      }));
  });
}

async function boosterPools(env: NodeJS.ProcessEnv, b: (typeof BOOSTERS)[number]) {
  return cached(`booster:${b.addr}`, 6 * 3600_000, async () => {
    const c = evmClient(b.chainId, env);
    const n = Number(
      await c.readContract({
        address: b.addr,
        abi: [parseAbiItem("function poolLength() view returns (uint256)")],
        functionName: "poolLength",
      }),
    );
    const r = await c.multicall({
      allowFailure: true,
      contracts: Array.from({ length: n }, (_, i) => ({
        address: b.addr,
        abi: [POOL_INFO],
        functionName: "poolInfo",
        args: [BigInt(i)],
      })) as never[],
    });
    return r.flatMap((x, i) =>
      x.status === "success"
        ? [
            {
              pid: i,
              lp: (x.result as any)[0] as string,
              rewards: (x.result as any)[3] as `0x${string}`,
            },
          ]
        : [],
    );
  });
}

export async function stakedLp(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<NewFound[]> {
  const out: NewFound[] = [];
  const gauges = await curveGauges(f).catch(() => [] as G[]);
  const lpPx = new Map(gauges.map((g) => [`${g.chainId}:${g.lp.toLowerCase()}`, g]));
  const byChain = new Map<number, G[]>();
  for (const g of gauges) byChain.set(g.chainId, [...(byChain.get(g.chainId) ?? []), g]);
  await Promise.all([
    ...[...byChain].map(async ([chainId, gs]) => {
      const r = (
        await callMany(
          chainId,
          env,
          gs.map((g) => g.gauge),
          SEL.balanceOf,
          owner,
        )
      ).map((v) => (v === null ? { status: "failure" } : { status: "success", result: v }));
      r.forEach((x, i) => {
        const bal = x.status === "success" ? (x.result as bigint) : 0n;
        if (bal < 1_000_000_000n) return; // dust
        const g = gs[i]!;
        const amt = Number(formatUnits(bal, 18));
        out.push({
          kind: "claimable",
          protocol: "Curve gauge",
          chainId,
          what: `${amt.toPrecision(6)} ${g.name} LP staked in its Curve gauge (exact balance; USD from Curve's LP price)`,
          valueUsd: g.px ? Math.round(amt * g.px * 100) / 100 : null,
          claimTx: gaugeWithdrawTx(chainId, g.gauge, bal, g.name),
          action:
            "Sign to unstake the LP to your wallet, then remove liquidity and swap on SwapChan",
          confidence: "high",
          evidence: [
            {
              chainId,
              address: g.gauge,
              call: "balanceOf(owner)",
              args: [owner],
              raw: [bal.toString()],
            },
          ],
        } as NewFound);
      });
    }),
    ...BOOSTERS.map(async (b) => {
      const pools = await boosterPools(env, b).catch(() => []);
      const bals = await callMany(
        b.chainId,
        env,
        pools.map((p) => p.rewards),
        SEL.balanceOf,
        owner,
      );
      const held = pools
        .map((p, i) => ({ p, bal: bals[i] ?? 0n }))
        .filter((h) => h.bal >= 1_000_000_000n);
      const earned = held.length
        ? await callMany(
            b.chainId,
            env,
            held.map((h) => h.p.rewards),
            SEL.earned,
            owner,
          )
        : [];
      const hits = held.map((h, i) => ({ ...h, earned: earned[i] ?? 0n }));
      if (!hits.length) return;
      const px = await prices(f, [
        ...hits.map((h) => ({ chainId: b.chainId, address: h.p.lp })),
        { chainId: b.chainId, address: b.reward.addr },
      ]).catch(() => new Map());
      const rp = pxOf(px, b.chainId, b.reward.addr)?.price ?? null;
      for (const h of hits) {
        const amt = Number(formatUnits(h.bal, 18));
        const cg = lpPx.get(`${b.chainId}:${h.p.lp.toLowerCase()}`);
        const lpp = cg?.px ?? pxOf(px, b.chainId, h.p.lp)?.price ?? null;
        const rew = Number(formatUnits(h.earned, 18));
        const usd =
          lpp === null && rp === null
            ? null
            : Math.round(((lpp ?? 0) * amt + (rp ?? 0) * rew) * 100) / 100;
        const nm = cg?.name ?? `pool ${h.p.pid}`;
        out.push({
          kind: "claimable",
          protocol: `${b.name} staked LP`,
          chainId: b.chainId,
          what: `${amt.toPrecision(6)} ${nm} LP staked in ${b.name} + ${rew.toPrecision(4)} ${b.reward.sym} earned (exact balances${lpp === null ? "; LP price unverified, USD counts rewards only" : ""})`,
          valueUsd: usd,
          claimTx: rewardPoolExitTx(b.chainId, h.p.rewards, h.bal, `${b.name} ${nm}`),
          action: `Sign to withdraw the LP and ${b.reward.sym} rewards to your wallet, then remove liquidity and swap on SwapChan`,
          confidence: "high",
          evidence: [
            {
              chainId: b.chainId,
              address: h.p.rewards,
              call: "balanceOf(owner), earned(owner)",
              args: [owner],
              raw: [h.bal.toString(), h.earned.toString()],
            },
          ],
        } as NewFound);
      }
    }),
  ]);
  return out;
}

/** SushiSwap MasterChef v1/v2 staked SLP (Ethereum). withdraw(pid, amount) pays msg.sender; v2 withdraw(pid, amount, to=owner). */
const CHEFS = [
  { v: 1, addr: "0xc2edad668740f1aa35e4d8f227fb8e17dca888cd" as const, pending: "pendingSushi" },
  { v: 2, addr: "0xef0881ec094552b2e128cf945ef17a6752b4ec5d" as const, pending: "pendingSushi" },
];
export const chefWithdrawTx = (
  v: number,
  chef: string,
  pid: number,
  amt: bigint,
  owner: `0x${string}`,
) => ({
  chainId: 1,
  to: chef,
  value: "0",
  data:
    v === 1
      ? encodeFunctionData({
          abi: [parseAbiItem("function withdraw(uint256,uint256)")],
          args: [BigInt(pid), amt],
        })
      : encodeFunctionData({
          abi: [parseAbiItem("function withdrawAndHarvest(uint256,uint256,address)")],
          args: [BigInt(pid), amt, owner],
        }),
  description: `Withdraw staked SushiSwap LP (pool ${pid}) and pending SUSHI to your wallet`,
});
export async function sushiChef(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<NewFound[]> {
  const c = evmClient(1, env);
  const per = await Promise.all(
    CHEFS.map(async (ch) => {
      const n = Number(
        await c.readContract({
          address: ch.addr,
          abi: [parseAbiItem("function poolLength() view returns (uint256)")],
          functionName: "poolLength",
        }),
      );
      const r = await c.multicall({
        allowFailure: true,
        batchSize: 4096,
        contracts: Array.from({ length: n }, (_, i) => ({
          address: ch.addr,
          abi: [parseAbiItem("function userInfo(uint256,address) view returns (uint256,int256)")],
          functionName: "userInfo",
          args: [BigInt(i), owner],
        })) as never[],
      });
      const hits = r.flatMap((x, pid) =>
        x.status === "success" && ((x.result as any)[0] as bigint) > 0n
          ? [{ pid, amt: (x.result as any)[0] as bigint }]
          : [],
      );
      if (!hits.length) return [];
      const lpAbi =
        ch.v === 1
          ? parseAbiItem(
              "function poolInfo(uint256) view returns (address,uint256,uint256,uint256)",
            )
          : parseAbiItem("function lpToken(uint256) view returns (address)");
      const meta = await c.multicall({
        allowFailure: true,
        contracts: hits.flatMap((h) => [
          {
            address: ch.addr,
            abi: [lpAbi],
            functionName: ch.v === 1 ? "poolInfo" : "lpToken",
            args: [BigInt(h.pid)],
          },
          {
            address: ch.addr,
            abi: [parseAbiItem("function pendingSushi(uint256,address) view returns (uint256)")],
            functionName: "pendingSushi",
            args: [BigInt(h.pid), owner],
          },
        ]) as never[],
      });
      return hits.map((h, i) => {
        const m = meta[2 * i];
        const lp =
          m?.status === "success" ? ((ch.v === 1 ? (m.result as any)[0] : m.result) as string) : "";
        const pend =
          meta[2 * i + 1]?.status === "success"
            ? (meta[2 * i + 1]!.result as unknown as bigint)
            : 0n;
        return { ...h, v: ch.v, chef: ch.addr, lp, pend };
      });
    }),
  );
  const all = per.flat();
  if (!all.length) return [];
  const SUSHI = "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2";
  const lpPx = await v2LpPrices(f, env, 1, [...new Set(all.map((h) => h.lp))]);
  const px = await prices(f, [{ chainId: 1, address: SUSHI }]).catch(() => new Map());
  const sp = pxOf(px, 1, SUSHI)?.price ?? null;
  return all.map((h) => {
    const amt = Number(formatUnits(h.amt, 18));
    const lpp = lpPx.get(h.lp.toLowerCase()) ?? null;
    const s = Number(formatUnits(h.pend, 18));
    const usd =
      lpp === null && sp === null
        ? null
        : Math.round(((lpp ?? 0) * amt + (sp ?? 0) * s) * 100) / 100;
    return {
      kind: "claimable",
      protocol: `SushiSwap MasterChef v${h.v}`,
      chainId: 1,
      what: `${amt.toPrecision(6)} SLP staked in pool ${h.pid} + ${s.toPrecision(4)} SUSHI pending (exact balances${lpp === null ? "; LP price unverified, USD counts SUSHI only" : ""})`,
      valueUsd: usd,
      claimTx: chefWithdrawTx(h.v, h.chef, h.pid, h.amt, owner),
      action:
        "Sign to withdraw the LP and SUSHI to your wallet, then remove liquidity and swap on SwapChan",
      confidence: "high",
      evidence: [
        {
          chainId: 1,
          address: h.chef,
          call: "userInfo(pid, owner), pendingSushi(pid, owner)",
          args: [String(h.pid), owner],
          raw: [h.amt.toString(), h.pend.toString()],
        },
      ],
    } as NewFound;
  });
}

/** Uniswap-v2-style LP price = (reserve0·p0 + reserve1·p1) / totalSupply, only when both legs price (after sanePx). */
export async function v2LpPrices(
  f: F,
  env: NodeJS.ProcessEnv,
  chainId: number,
  lps: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!lps.length) return out;
  const c = evmClient(chainId, env);
  const A = (x: string) => parseAbiItem(x);
  const r = await c
    .multicall({
      allowFailure: true,
      contracts: lps.flatMap((lp) => [
        {
          address: lp.toLowerCase() as `0x${string}`,
          abi: [A("function token0() view returns (address)")],
          functionName: "token0",
        },
        {
          address: lp.toLowerCase() as `0x${string}`,
          abi: [A("function token1() view returns (address)")],
          functionName: "token1",
        },
        {
          address: lp.toLowerCase() as `0x${string}`,
          abi: [A("function getReserves() view returns (uint112,uint112,uint32)")],
          functionName: "getReserves",
        },
        {
          address: lp.toLowerCase() as `0x${string}`,
          abi: [A("function totalSupply() view returns (uint256)")],
          functionName: "totalSupply",
        },
      ]) as never[],
    })
    .catch(() => []);
  const rows = lps.map((lp, i) => ({
    lp,
    t0: r[4 * i]?.result as string | undefined,
    t1: r[4 * i + 1]?.result as string | undefined,
    res: r[4 * i + 2]?.result as unknown as readonly bigint[] | undefined,
    ts: r[4 * i + 3]?.result as unknown as bigint | undefined,
  }));
  const px = await prices(
    f,
    rows.flatMap((x) =>
      x.t0 && x.t1
        ? [
            { chainId, address: x.t0 },
            { chainId, address: x.t1 },
          ]
        : [],
    ),
  ).catch(() => new Map());
  for (const x of rows) {
    if (!x.t0 || !x.t1 || !x.res || !x.ts) continue;
    const p0 = pxOf(px, chainId, x.t0),
      p1 = pxOf(px, chainId, x.t1);
    if (!p0?.price || !p1?.price || p0.decimals === undefined || p1.decimals === undefined)
      continue;
    const v =
      Number(formatUnits(x.res[0]!, p0.decimals)) * p0.price +
      Number(formatUnits(x.res[1]!, p1.decimals)) * p1.price;
    out.set(x.lp.toLowerCase(), v / Number(formatUnits(x.ts, 18)));
  }
  return out;
}
