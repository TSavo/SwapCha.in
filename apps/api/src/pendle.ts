import { encodeFunctionData, getAddress, parseAbiItem } from "viem";
import { evmClient } from "./onchain.js";
import type { NewFound } from "./recover.js";

/** Matured Pendle: PT/LP past expiry (redeem via Router exitPostExpToToken) and loose SY (SY.redeem).
 *  Detection: Pendle dashboard API, confirmed with on-chain balanceOf. USD = Pendle's valuation (estimate). */
type F = typeof fetch;
export const PENDLE_ROUTER = "0x888888888889758f76e7103c6cbf23abbf58f946";
const API = "https://api-v2.pendle.finance/core/v1";
const EXIT = parseAbiItem("function exitPostExpToToken(address receiver, address market, uint256 netPtIn, uint256 netLpIn, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output)");
const REDEEM = parseAbiItem("function redeem(address receiver, uint256 amountSharesToRedeem, address tokenOut, uint256 minTokenOut, bool burnFromInternalBalance) returns (uint256)");
const APPROVE = parseAbiItem("function approve(address spender, uint256 amount) returns (bool)");
const Z = "0x0000000000000000000000000000000000000000";
export const exitTx = (chainId: number, owner: `0x${string}`, market: string, pt: bigint, lp: bigint, tokenOut: string) => ({
  chainId, to: PENDLE_ROUTER, value: "0",
  data: encodeFunctionData({ abi: [EXIT], args: [owner, market as `0x${string}`, pt, lp, { tokenOut: tokenOut as `0x${string}`, minTokenOut: 0n, tokenRedeemSy: tokenOut as `0x${string}`, pendleSwap: Z, swapData: { swapType: 0, extRouter: Z, extCalldata: "0x", needScale: false } }] }),
  description: "Redeem matured Pendle PT/LP to your wallet",
});
export const approveTx = (chainId: number, token: string, amt: bigint, what: string) => ({
  chainId, to: token, value: "0", data: encodeFunctionData({ abi: [APPROVE], args: [PENDLE_ROUTER, amt] }),
  description: `Step 1 of 2: let the Pendle Router redeem your ${what} (approval only, moves nothing)`,
});
export const syRedeemTx = (chainId: number, owner: `0x${string}`, sy: string, amt: bigint, tokenOut: string) => ({
  chainId, to: sy, value: "0", data: encodeFunctionData({ abi: [REDEEM], args: [owner, amt, tokenOut as `0x${string}`, 0n, false] }),
  description: "Redeem Pendle SY to its underlying token in your wallet",
});

const j = async <T,>(f: F, u: string): Promise<T | null> => { const r = await f(u, { signal: AbortSignal.timeout(7000) }).catch(() => null); return r?.ok ? ((await r.json()) as T) : null; };
type Pos = { chainId: number; openPositions: P[]; closedPositions: P[]; syPositions: { syId: string; balance: string }[] };
type P = { marketId: string; pt: { valuation: number; balance: string }; lp: { valuation: number; balance: string } };
type Market = { address: string; expiry: string; pt: { address: string; symbol: string }; lp: { address: string }; sy: { address: string; symbol: string }; underlyingAsset?: { address: string; symbol: string } };
const BAL = parseAbiItem("function balanceOf(address) view returns (uint256)");
const ALW = parseAbiItem("function allowance(address,address) view returns (uint256)");
const OUTS = parseAbiItem("function getTokensOut() view returns (address[])");

export async function maturedPendle(f: F, env: NodeJS.ProcessEnv, owner: `0x${string}`, now = Date.now()): Promise<NewFound[]> {
  const d = await j<{ positions: Pos[] }>(f, `${API}/dashboard/positions/database/${owner}`);
  if (!d) throw new Error("Pendle API unavailable");
  const out: NewFound[] = [];
  await Promise.all(d.positions.map(async (c) => {
    const cands = [...c.openPositions, ...c.closedPositions].filter((p) => BigInt(p.pt.balance) > 0n || BigInt(p.lp.balance) > 0n);
    const markets = (await Promise.all(cands.map((p) => j<Market>(f, `${API}/${c.chainId}/markets/${p.marketId.split("-")[1]}`)))).map((m, i) => ({ m, p: cands[i]! }))
      .filter((x) => x.m && Date.parse(x.m.expiry) < now) as { m: Market; p: P }[];
    let cl;
    try { cl = evmClient(c.chainId, env); } catch { return; }
    const pickOut = async (sy: string, pref?: string) => {
      const o = (await cl.readContract({ address: sy as `0x${string}`, abi: [OUTS], functionName: "getTokensOut" }).catch(() => [])) as string[];
      return o.find((t) => pref && t.toLowerCase() === pref.toLowerCase()) ?? o[0];
    };
    await Promise.all(markets.map(async ({ m, p }) => {
      const pt = m.pt.address as `0x${string}`, lp = m.lp.address as `0x${string}`;
      const r = await cl.multicall({ allowFailure: true, contracts: [
        { address: pt, abi: [BAL], functionName: "balanceOf", args: [owner] }, { address: lp, abi: [BAL], functionName: "balanceOf", args: [owner] },
        { address: pt, abi: [ALW], functionName: "allowance", args: [owner, PENDLE_ROUTER] }, { address: lp, abi: [ALW], functionName: "allowance", args: [owner, PENDLE_ROUTER] },
      ] }).catch(() => null);
      if (!r) return;
      const [bp, bl, ap, al] = r.map((x) => (x.result as bigint | undefined) ?? 0n) as [bigint, bigint, bigint, bigint];
      if (bp === 0n && bl === 0n) return;
      const tokenOut = await pickOut(m.sy.address, m.underlyingAsset?.address);
      if (!tokenOut) return;
      const usd = Math.round(((bp > 0n ? p.pt.valuation : 0) + (bl > 0n ? p.lp.valuation : 0)) * 100) / 100;
      const needPt = bp > 0n && ap < bp, needLp = bl > 0n && al < bl;
      const tx = needPt ? approveTx(c.chainId, pt, bp, m.pt.symbol) : needLp ? approveTx(c.chainId, lp, bl, "Pendle LP") : exitTx(c.chainId, owner, m.address, bp, bl, tokenOut);
      out.push({
        kind: "claimable", protocol: "Pendle (matured)", chainId: c.chainId,
        what: `${m.pt.symbol} matured ${m.expiry.slice(0, 10)}: ${bp > 0n ? "PT" : ""}${bp > 0n && bl > 0n ? " + " : ""}${bl > 0n ? "LP" : ""} redeemable (USD is Pendle's valuation, estimate)`,
        valueUsd: usd || null, claimTx: tx,
        action: needPt || needLp ? "Sign the one-time approval, then run find_money again for the redeem transaction (pays your wallet)" : "Sign one transaction to redeem the matured position into your wallet, then swap on SwapChan",
        confidence: "high",
        evidence: [{ chainId: c.chainId, address: pt, call: "balanceOf", args: [owner], raw: bp.toString() }, { chainId: c.chainId, address: lp, call: "balanceOf", args: [owner], raw: bl.toString() }, { chainId: c.chainId, address: m.address, call: "Pendle API market.expiry", args: [], raw: m.expiry }],
      });
    }));
    await Promise.all(c.syPositions.filter((s) => BigInt(s.balance) > 0n).map(async (s) => {
      const sy = getAddress(s.syId.split("-")[1]!);
      const b = (await cl.readContract({ address: sy, abi: [BAL], functionName: "balanceOf", args: [owner] }).catch(() => 0n)) as bigint;
      if (b === 0n) return;
      const tokenOut = await pickOut(sy);
      if (!tokenOut) return;
      out.push({
        kind: "claimable", protocol: "Pendle SY", chainId: c.chainId,
        what: `Loose Pendle SY balance (${b} raw units) redeemable to its underlying; not priced`,
        valueUsd: null, claimTx: syRedeemTx(c.chainId, owner, sy, b, tokenOut),
        action: "Sign one transaction to redeem SY into the underlying token in your wallet", confidence: "medium",
        evidence: [{ chainId: c.chainId, address: sy, call: "balanceOf", args: [owner], raw: b.toString() }],
      });
    }));
  }));
  return out;
}
