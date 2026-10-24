import { encodeFunctionData, formatEther, getAddress, parseAbiItem } from "viem";
import { NATIVE_TOKEN } from "@swapchan/shared";
import { evmClient, prices, pxOf } from "./onchain.js";
import type { NewFound } from "./recover.js";

/**
 * Liquid-staking withdrawal queues on Ethereum: ether.fi WithdrawRequestNFT, Frax redemption tickets,
 * Swell swEXIT, Stader ETHx. Finalized/matured = claim tx (exact ETH). Still queued = reported, no tx.
 */
type F = typeof fetch;
const fn = (s: string) => [parseAbiItem(`function ${s}`)] as const;
export const ETHERFI = "0x7d5706f6ef3F89B3951E23e557CDFBC3239D4E2c" as const;
export const FRAX_Q = "0x82bA8da44Cd5261762e629dd5c605b17715727bd" as const;
export const SWEXIT = "0x48C11b86807627AF70a34662D4865cF854251663" as const;
export const STADER = "0x9F0491B32DBce587c50c4C43AB303b06478193A7" as const;

export const etherfiClaimTx = (id: bigint) => ({ chainId: 1, to: ETHERFI, value: "0", description: `ether.fi: claimWithdraw(#${id})`, data: encodeFunctionData({ abi: fn("claimWithdraw(uint256 tokenId)"), args: [id] }) });
export const fraxClaimTx = (id: bigint, owner: `0x${string}`) => ({ chainId: 1, to: FRAX_Q, value: "0", description: `Frax: burnRedemptionTicketNft(#${id}) to you`, data: encodeFunctionData({ abi: fn("burnRedemptionTicketNft(uint256 _nftId,address _recipient)"), args: [id, owner] }) });
export const swellClaimTx = (id: bigint) => ({ chainId: 1, to: SWEXIT, value: "0", description: `Swell: finalizeWithdrawal(#${id})`, data: encodeFunctionData({ abi: fn("finalizeWithdrawal(uint256 tokenId)"), args: [id] }) });
export const staderClaimTx = (id: bigint) => ({ chainId: 1, to: STADER, value: "0", description: `Stader: claim(#${id})`, data: encodeFunctionData({ abi: fn("claim(uint256 _requestId)"), args: [id] }) });

/** Token ids received (Blockscout ERC-721 transfers, keyless), then kept only if ownerOf is still the owner. */
async function nftIds(f: F, env: NodeJS.ProcessEnv, owner: `0x${string}`): Promise<Map<string, bigint[]>> {
  const c = evmClient(1, env);
  const out = new Map<string, bigint[]>();
  await Promise.all(
    [ETHERFI, FRAX_Q, SWEXIT].map(async (t) => {
      const cand = new Set<string>();
      let q = "";
      for (let page = 0; page < 4; page++) {
        const r = await f(`https://eth.blockscout.com/api/v2/addresses/${owner}/token-transfers?type=ERC-721&filter=to&token=${t}${q}`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) throw new Error(`blockscout transfers ${r.status}`);
        const d = (await r.json()) as { items: { total?: { token_id?: string } }[]; next_page_params: Record<string, unknown> | null };
        for (const it of d.items) if (it.total?.token_id) cand.add(it.total.token_id);
        if (!d.next_page_params) break;
        q = "&" + new URLSearchParams(Object.entries(d.next_page_params).map(([k, v]) => [k, String(v)])).toString();
      }
      const ids = [...cand].slice(0, 60).map(BigInt);
      const own = await Promise.all(
        ids.map((id) => c.readContract({ address: t, abi: fn("ownerOf(uint256) view returns (address)"), functionName: "ownerOf", args: [id] }).catch(() => null)),
      );
      const keep = ids.filter((_, i) => own[i] && getAddress(own[i] as string) === getAddress(owner));
      if (keep.length) out.set(t.toLowerCase(), keep);
    }),
  );
  return out;
}

export async function lstQueues(f: F, env: NodeJS.ProcessEnv, owner: `0x${string}`): Promise<NewFound[]> {
  const c = evmClient(1, env);
  const [ids, staderIds, px] = await Promise.all([
    nftIds(f, env, owner),
    c.readContract({ address: STADER, abi: fn("getRequestIdsByUser(address) view returns (uint256[])"), functionName: "getRequestIdsByUser", args: [owner] }).catch(() => [] as readonly bigint[]),
    prices(f, [{ chainId: 1, address: NATIVE_TOKEN }]).catch(() => new Map()),
  ]);
  const eth = pxOf(px, 1, NATIVE_TOKEN)?.price ?? null;
  const usd = (w: bigint) => (eth ? Math.round(Number(formatEther(w)) * eth * 100) / 100 : null);
  const out: NewFound[] = [];
  const push = (protocol: string, id: bigint, wei: bigint, ready: boolean, exact: boolean, tx: { chainId: number; to: string; value: string; description: string; data: `0x${string}` } | null, contract: string, call: string, raw: string, wait?: string) =>
    out.push({
      kind: "claimable",
      protocol,
      chainId: 1,
      what: `Withdrawal #${id}: ${Number(formatEther(wei)).toFixed(4)} ETH ${ready ? "ready to claim" : `still queued${wait ? ` (${wait})` : ""}`} (${exact ? "exact" : "estimate"})`,
      valueUsd: usd(wei),
      ...(ready && tx ? { claimTx: tx } : {}),
      action: ready ? `Sign ${tx?.description} to receive the ETH, then swap on SwapChan` : "Nothing to sign yet; check back once the queue finalizes.",
      confidence: "high",
      evidence: [{ chainId: 1, address: contract, call, args: [id.toString()], raw }],
    });
  const ef = ids.get(ETHERFI.toLowerCase()) ?? [];
  await Promise.all(
    ef.slice(0, 20).map(async (id) => {
      const [fin, req] = await Promise.all([
        c.readContract({ address: ETHERFI, abi: fn("isFinalized(uint256) view returns (bool)"), functionName: "isFinalized", args: [id] }),
        c.readContract({ address: ETHERFI, abi: fn("getRequest(uint256) view returns ((uint96 amountOfEEth,uint96 shareOfEEth,bool isValid,uint32 feeGwei))"), functionName: "getRequest", args: [id] }),
      ]);
      const amt = fin
        ? ((await c.readContract({ address: ETHERFI, abi: fn("getClaimableAmount(uint256) view returns (uint256)"), functionName: "getClaimableAmount", args: [id] })) as bigint)
        : BigInt((req as { amountOfEEth: bigint }).amountOfEEth);
      if (amt > 0n) push("ether.fi withdrawal", id, amt, Boolean(fin), Boolean(fin), etherfiClaimTx(id), ETHERFI, fin ? "getClaimableAmount(uint256)" : "getRequest(uint256)", amt.toString());
    }),
  );
  const now = BigInt(Math.floor(Date.now() / 1000));
  await Promise.all(
    (ids.get(FRAX_Q.toLowerCase()) ?? []).slice(0, 20).map(async (id) => {
      const [redeemed, maturity, amount] = (await c.readContract({ address: FRAX_Q, abi: fn("nftInformation(uint256) view returns (bool,uint64,uint120,uint64)"), functionName: "nftInformation", args: [id] })) as [boolean, bigint, bigint, bigint];
      if (redeemed || amount === 0n) return;
      const ready = maturity <= now;
      push("Frax frxETH redemption", id, amount, ready, true, fraxClaimTx(id, owner), FRAX_Q, "nftInformation(uint256)", `${maturity}`, ready ? undefined : `matures ${new Date(Number(maturity) * 1000).toISOString().slice(0, 10)}`);
    }),
  );
  await Promise.all(
    (ids.get(SWEXIT.toLowerCase()) ?? []).slice(0, 20).map(async (id) => {
      const [[done, rate], req] = await Promise.all([
        c.readContract({ address: SWEXIT, abi: fn("getProcessedRateForTokenId(uint256) view returns (bool,uint256)"), functionName: "getProcessedRateForTokenId", args: [id] }) as Promise<[boolean, bigint]>,
        c.readContract({ address: SWEXIT, abi: fn("withdrawalRequests(uint256) view returns (uint256,uint256,uint256)"), functionName: "withdrawalRequests", args: [id] }) as Promise<[bigint, bigint, bigint]>,
      ]);
      const wei = (req[0] * (done ? rate : req[2])) / 10n ** 18n;
      if (wei > 0n) push("Swell swETH withdrawal", id, wei, done, done, swellClaimTx(id), SWEXIT, "getProcessedRateForTokenId(uint256)", `${done},${rate}`);
    }),
  );
  if ((staderIds as readonly bigint[]).length) {
    const next = (await c.readContract({ address: STADER, abi: fn("nextRequestIdToFinalize() view returns (uint256)"), functionName: "nextRequestIdToFinalize" })) as bigint;
    await Promise.all(
      (staderIds as readonly bigint[]).slice(0, 20).map(async (id) => {
        const [o, , expected, finalized] = (await c.readContract({ address: STADER, abi: fn("userWithdrawRequests(uint256) view returns (address,uint256,uint256,uint256,uint256)"), functionName: "userWithdrawRequests", args: [id] })) as [string, bigint, bigint, bigint, bigint];
        if (getAddress(o) !== getAddress(owner)) return;
        const ready = id < next;
        push("Stader ETHx withdrawal", id, ready ? finalized : expected, ready, ready, staderClaimTx(id), STADER, "userWithdrawRequests(uint256)", `${expected},${finalized}`);
      }),
    );
  }
  return out;
}
