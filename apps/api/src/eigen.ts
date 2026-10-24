import { encodeFunctionData, formatUnits, getAddress, parseAbiItem, toHex, zeroAddress } from "viem";
import { evmClient, prices, pxOf, swapUrl, usdcOf } from "./onchain.js";
import { NATIVE_TOKEN } from "@swapchan/shared";
import type { NewFound } from "./recover.js";

/**
 * EigenLayer (Ethereum): restaked deposits (StrategyManager + EigenPod shares) and queued withdrawals.
 * Queued + past the delay = completeQueuedWithdrawal tx (exact). Still deposited = queueWithdrawals tx (step 1 of 2).
 */
type F = typeof fetch;
const fn = (s: string) => [parseAbiItem(`function ${s}`)] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;
// bEIGEN (the strategy's backing token) trades 1:1 as EIGEN
const PRICE_AS: Record<string, string> = {
  "0x83e9115d334d248ce39a6f36144aeab5b3456e75": "0xec53bF9167f50cDEB3Ae105f56099aaaB9061F83",
};
const sumUsd = (ps: { usd: number | null }[]) =>
  ps.some((p) => p.usd !== null) ? r2(ps.reduce((a, p) => a + (p.usd ?? 0), 0)) : null;
export const DELEGATION = "0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A" as const;
export const STRATEGY_MANAGER = "0x858646372CC42E1A627fcE94aa7A7033e7CF075A" as const;
export const BEACON_STRATEGY = "0xbeaC0eeEeeeeEEeEeEEEEeeEEeEeeeEeeEEBEaC0" as const;
const W =
  "(address staker,address delegatedTo,address withdrawer,uint256 nonce,uint32 startBlock,address[] strategies,uint256[] scaledShares)";
type Wd = {
  staker: `0x${string}`;
  delegatedTo: `0x${string}`;
  withdrawer: `0x${string}`;
  nonce: bigint;
  startBlock: number;
  strategies: readonly `0x${string}`[];
  scaledShares: readonly bigint[];
};

export function completeTx(w: Wd, tokens: `0x${string}`[]) {
  return {
    chainId: 1,
    to: DELEGATION,
    data: encodeFunctionData({
      abi: fn(`completeQueuedWithdrawal(${W},address[],bool)`),
      functionName: "completeQueuedWithdrawal",
      args: [w, tokens, true],
    }),
    value: "0",
    description: "completeQueuedWithdrawal(…, receiveAsTokens=true): receive your unstaked tokens",
  };
}
export function queueTx(strategies: `0x${string}`[], shares: bigint[], owner: `0x${string}`) {
  return {
    chainId: 1,
    to: DELEGATION,
    data: encodeFunctionData({
      abi: fn("queueWithdrawals((address[] strategies,uint256[] depositShares,address withdrawer)[])"),
      functionName: "queueWithdrawals",
      args: [[{ strategies, depositShares: shares, withdrawer: owner }]],
    }),
    value: "0",
    description: "queueWithdrawals: start the EigenLayer unstake (step 1; complete after the delay)",
  };
}

export async function eigenLayer(f: F, env: NodeJS.ProcessEnv, owner: `0x${string}`): Promise<NewFound[]> {
  const c = evmClient(1, env);
  const [dep, queued, delay, block, withdrawable] = await Promise.all([
    c.readContract({ address: DELEGATION, abi: fn("getDepositedShares(address) view returns (address[],uint256[])"), functionName: "getDepositedShares", args: [owner] }).catch(() =>
      c.readContract({ address: STRATEGY_MANAGER, abi: fn("getDeposits(address) view returns (address[],uint256[])"), functionName: "getDeposits", args: [owner] }),
    ),
    c.readContract({ address: DELEGATION, abi: fn(`getQueuedWithdrawals(address) view returns (${W}[],uint256[][])`), functionName: "getQueuedWithdrawals", args: [owner] }).catch(() => [[], []] as const),
    c.readContract({ address: DELEGATION, abi: fn("minWithdrawalDelayBlocks() view returns (uint32)"), functionName: "minWithdrawalDelayBlocks" }).catch(() => 100800),
    c.getBlockNumber(),
    Promise.resolve(null),
  ]);
  void withdrawable;
  const [strats, shares] = dep as [readonly `0x${string}`[], readonly bigint[]];
  const [ws, wShares] = queued as unknown as [Wd[], bigint[][]];
  const all = [...new Set([...strats, ...ws.flatMap((w) => w.strategies)].map((s) => getAddress(s)))];
  if (!all.length) return [];
  const isBeacon = (s: string) => s.toLowerCase() === BEACON_STRATEGY.toLowerCase();
  const meta = await Promise.all(
    all.map(async (s) => {
      if (isBeacon(s)) return { s, token: NATIVE_TOKEN as string, dec: 18, sym: "ETH", rate: 10n ** 18n };
      const token = (await c.readContract({ address: s, abi: fn("underlyingToken() view returns (address)"), functionName: "underlyingToken" })) as `0x${string}`;
      const [dec, sym, rate] = await Promise.all([
        c.readContract({ address: token, abi: fn("decimals() view returns (uint8)"), functionName: "decimals" }).catch(() => 18),
        c.readContract({ address: token, abi: fn("symbol() view returns (string)"), functionName: "symbol" }).catch(() => "?"),
        c.readContract({ address: s, abi: fn("sharesToUnderlyingView(uint256) view returns (uint256)"), functionName: "sharesToUnderlyingView", args: [10n ** 18n] }).catch(() => 10n ** 18n),
      ]);
      return { s, token: token as string, dec: Number(dec), sym: String(sym), rate: rate as bigint };
    }),
  );
  const m = new Map(meta.map((x) => [x.s.toLowerCase(), x]));
  const px = await prices(f, meta.map((x) => ({ chainId: 1, address: PRICE_AS[x.token.toLowerCase()] ?? x.token }))).catch(() => new Map());
  const usd = (s: string, sh: bigint) => {
    const x = m.get(s.toLowerCase())!;
    const amt = Number(formatUnits((sh * x.rate) / 10n ** 18n, x.dec));
    const p = pxOf(px, 1, PRICE_AS[x.token.toLowerCase()] ?? x.token)?.price ?? null;
    return { amt, usd: p ? amt * p : null, x };
  };
  const out: NewFound[] = [];
  ws.forEach((w, i) => {
    const sh = wShares[i] ?? w.scaledShares;
    const parts = w.strategies.map((s, k) => usd(s, sh[k] ?? 0n));
    const total = sumUsd(parts);
    const ready = BigInt(w.startBlock) + BigInt(Number(delay)) <= block;
    const desc = parts.map((p) => `${p.amt.toPrecision(5)} ${p.x.sym}`).join(" + ");
    const first = parts[0]?.x;
    out.push({
      kind: "claimable",
      protocol: "EigenLayer queued withdrawal",
      chainId: 1,
      what: ready
        ? `${desc} unstaked and ready to complete (getQueuedWithdrawals, exact)`
        : `${desc} unstaking; completable after block ${BigInt(w.startBlock) + BigInt(Number(delay))}`,
      valueUsd: total,
      ...(ready
        ? { claimTx: completeTx(w, w.strategies.map((s) => (isBeacon(s) ? zeroAddress : (m.get(s.toLowerCase())!.token as `0x${string}`)))) }
        : {}),
      action: ready ? "Complete the withdrawal, then swap on SwapChan" : "Wait for the EigenLayer delay, then complete",
      ...(first && usdcOf(1) ? { link: swapUrl(1, first.token, 1, usdcOf(1)!, String(parts[0]!.amt)) } : {}),
      evidence: [{ chainId: 1, address: DELEGATION, call: "getQueuedWithdrawals(address)", abi: "getQueuedWithdrawals(address)", args: [owner], raw: toHex(w.nonce) }],
      confidence: "high",
    });
  });
  const live = strats.map((s, i) => ({ s: getAddress(s), sh: shares[i]! })).filter((x) => x.sh > 0n);
  if (live.length) {
    const parts = live.map((x) => usd(x.s, x.sh));
    const total = sumUsd(parts);
    const nonBeacon = live.filter((x) => !isBeacon(x.s));
    out.push({
      kind: "legacy",
      protocol: "EigenLayer restaked",
      chainId: 1,
      what: `${parts.map((p) => `${p.amt.toPrecision(5)} ${p.x.sym}`).join(" + ")} restaked (getDepositedShares, exact)`,
      valueUsd: total,
      ...(nonBeacon.length ? { claimTx: queueTx(nonBeacon.map((x) => x.s), nonBeacon.map((x) => x.sh), owner) } : {}),
      action: "Queue the withdrawal now, complete it after the EigenLayer delay (~14 days), then swap",
      evidence: [{ chainId: 1, address: DELEGATION, call: "getDepositedShares(address)", abi: "getDepositedShares(address)", args: [owner], raw: toHex(live[0]!.sh) }],
      confidence: "high",
    });
  }
  return out;
}
