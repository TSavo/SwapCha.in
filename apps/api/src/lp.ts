import { decodeFunctionResult, encodeFunctionData, formatUnits, parseAbiItem } from "viem";
import { exitDeadline, minOut, PRIVATE_SUBMISSION_NOTE } from "./exitguard.js";
import { evmClient, prices, pxOf } from "./onchain.js";
import type { NewFound } from "./recover.js";

/**
 * Concentrated-liquidity positions (Uniswap v3 NPM on 7 chains, Sushi v3, Pancake v3 on BSC):
 * principal + fees, exact, from simulating multicall([decreaseLiquidity(all), collect(to owner)]) as the owner.
 * The same multicall is the recovery tx.
 */
type F = typeof fetch;
const MAX = 2n ** 128n - 1n;
export const NPMS: { chainId: number; npm: `0x${string}`; name: string }[] = [
  { chainId: 1, npm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", name: "Uniswap v3" },
  { chainId: 10, npm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", name: "Uniswap v3" },
  { chainId: 42161, npm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", name: "Uniswap v3" },
  { chainId: 137, npm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", name: "Uniswap v3" },
  { chainId: 8453, npm: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1", name: "Uniswap v3" },
  { chainId: 56, npm: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613", name: "Uniswap v3" },
  { chainId: 43114, npm: "0x655C406EBFa14EE2006250925e54ec43AD184f8B", name: "Uniswap v3" },
  { chainId: 1, npm: "0x2214A42d8e2A1d20635c2cb0664422c528B6A432", name: "Sushi v3" },
  { chainId: 42161, npm: "0xF0cBce1942A68BEB3d1b73F0dd86C8DCc363eF49", name: "Sushi v3" },
  { chainId: 56, npm: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364", name: "PancakeSwap v3" },
];
const DEC = parseAbiItem(
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) returns (uint256,uint256)",
);
const COL = parseAbiItem(
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) returns (uint256,uint256)",
);
const MC = parseAbiItem("function multicall(bytes[] data) payable returns (bytes[] results)");
const POS = parseAbiItem(
  "function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)",
);

/** mins = quoted principal out of decreaseLiquidity (from simulation) minus slippage; null = quote pass (mins 0, never offered). */
export function exitTx(
  chainId: number,
  npm: string,
  id: bigint,
  liquidity: bigint,
  owner: `0x${string}`,
  quoted: readonly [bigint, bigint] | null = null,
  nowMs = Date.now(),
) {
  const [m0, m1] = quoted ? [minOut(quoted[0]), minOut(quoted[1])] : [0n, 0n];
  const calls = [
    ...(liquidity > 0n
      ? [
          encodeFunctionData({
            abi: [DEC],
            args: [
              {
                tokenId: id,
                liquidity,
                amount0Min: m0,
                amount1Min: m1,
                deadline: exitDeadline(nowMs),
              },
            ],
          }),
        ]
      : []),
    encodeFunctionData({
      abi: [COL],
      args: [{ tokenId: id, recipient: owner, amount0Max: MAX, amount1Max: MAX }],
    }),
  ];
  return {
    chainId,
    to: npm,
    value: "0",
    data: encodeFunctionData({ abi: [MC], args: [calls] }),
    description: `Remove all liquidity from position #${id} and collect to your wallet`,
  };
}

export async function clPositions(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: `0x${string}`,
): Promise<NewFound[]> {
  const per = await Promise.all(
    NPMS.map(async ({ chainId, npm, name }) => {
      const c = evmClient(chainId, env);
      const n = (await c
        .readContract({
          address: npm,
          abi: [parseAbiItem("function balanceOf(address) view returns (uint256)")],
          functionName: "balanceOf",
          args: [owner],
        })
        .catch(() => 0n)) as bigint;
      if (n === 0n) return [];
      // big holders: the oldest 20 and the newest 60 indexes (active positions tend to be recent)
      const N = Number(n);
      const idx =
        N <= 80
          ? Array.from({ length: N }, (_, i) => i)
          : [
              ...Array.from({ length: 20 }, (_, i) => i),
              ...Array.from({ length: 60 }, (_, i) => N - 60 + i),
            ];
      const ids = (
        await c.multicall({
          allowFailure: true,
          contracts: idx.map((i) => ({
            address: npm,
            abi: [
              parseAbiItem("function tokenOfOwnerByIndex(address,uint256) view returns (uint256)"),
            ],
            functionName: "tokenOfOwnerByIndex",
            args: [owner, BigInt(i)],
          })) as never[],
        })
      )
        .map((r) => (r.status === "success" ? (r.result as bigint) : null))
        .filter((x): x is bigint => x !== null);
      const ps = await c.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          address: npm,
          abi: [POS],
          functionName: "positions",
          args: [id],
        })) as never[],
      });
      const out: {
        chainId: number;
        npm: string;
        name: string;
        id: bigint;
        liq: bigint;
        t0: string;
        t1: string;
        a0: bigint;
        a1: bigint;
        tx: ReturnType<typeof exitTx>;
      }[] = [];
      const live: number[] = [];
      ids.forEach((_, i) => live.push(i));
      await Promise.all(
        ids.map(async (id, i) => {
          const r = ps[i];
          if (!r || r.status !== "success") return;
          const p = r.result as unknown as readonly unknown[];
          const liq = p[7] as bigint;
          if (liq === 0n && (p[10] as bigint) === 0n && (p[11] as bigint) === 0n) return;
          // quote pass: simulate with zero mins as the owner, then build the real tx with mins from the quote
          const probe = exitTx(chainId, npm, id, liq, owner);
          const sim = await c
            .call({ account: owner, to: npm, data: probe.data as `0x${string}` })
            .catch(() => null);
          if (!sim?.data) return;
          const res = decodeFunctionResult({
            abi: [MC],
            data: sim.data,
          }) as readonly `0x${string}`[];
          const [a0, a1] = decodeFunctionResult({
            abi: [COL],
            data: res[res.length - 1]!,
          }) as readonly [bigint, bigint];
          if (a0 === 0n && a1 === 0n) return;
          const principal =
            liq > 0n
              ? (decodeFunctionResult({ abi: [DEC], data: res[0]! }) as readonly [bigint, bigint])
              : ([0n, 0n] as const);
          const tx = exitTx(chainId, npm, id, liq, owner, principal);
          out.push({ chainId, npm, name, id, liq, t0: String(p[2]), t1: String(p[3]), a0, a1, tx });
        }),
      );
      return out;
    }),
  );
  const all = per.flat();
  if (!all.length) return [];
  const px = await prices(
    f,
    all.flatMap((x) => [
      { chainId: x.chainId, address: x.t0 },
      { chainId: x.chainId, address: x.t1 },
    ]),
  ).catch(() => new Map());
  return all.map((x) => {
    const leg = (t: string, a: bigint) => {
      const p = pxOf(px, x.chainId, t);
      const amt = p?.decimals !== undefined ? Number(formatUnits(a, p.decimals)) : null;
      return {
        unp: !p?.price,
        s: `${amt === null ? a.toString() + " raw" : amt.toPrecision(6)} ${p?.symbol ?? t.slice(0, 8)}`,
        usd: amt !== null && p?.price ? amt * p.price : null,
      };
    };
    const l0 = leg(x.t0, x.a0);
    const l1 = leg(x.t1, x.a1);
    const usd =
      l0.usd === null && l1.usd === null
        ? null
        : Math.round(((l0.usd ?? 0) + (l1.usd ?? 0)) * 100) / 100;
    return {
      kind: "claimable" as const,
      protocol: `${x.name} LP`,
      chainId: x.chainId,
      what: `Position #${x.id}${x.liq > 0n ? "" : " (liquidity already removed)"}: ${l0.s} + ${l1.s} incl. fees (exact, simulated as you)${
        l0.unp || l1.unp
          ? "; USD counts priced legs only, " +
            [l0, l1]
              .filter((l) => l.unp)
              .map((l) => l.s.split(" ").pop())
              .join("/") +
            " price unverified"
          : ""
      }`,
      valueUsd: usd,
      claimTx: x.tx,
      action:
        `Sign one transaction to remove the liquidity and collect both tokens to your wallet, then swap on SwapChan. ${x.liq > 0n ? PRIVATE_SUBMISSION_NOTE : ""}`.trim(),
      confidence: "high" as const,
      evidence: [
        {
          chainId: x.chainId,
          address: x.npm,
          call: "eth_call multicall(decreaseLiquidity,collect) from owner",
          args: [x.id.toString()],
          raw: [x.a0.toString(), x.a1.toString()],
        },
      ],
    };
  });
}
