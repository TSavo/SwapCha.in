import { isEvmChain, Quote, type QuoteRequest } from "@swapchan/shared";
import type { Pricer } from "../pricing.js";
import { type Fetch, getJson, type ProviderAdapter } from "./types.js";

const BASE = "https://aggregator-api.kyberswap.com";
const SLUG: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon",
  56: "bsc",
  43114: "avalanche",
  59144: "linea",
  534352: "scroll",
};
const KYBER_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const toKyber = (a: string) =>
  a.toLowerCase() === "0x0000000000000000000000000000000000000000" ? KYBER_NATIVE : a;

interface Hop {
  amountOut: string;
  exchange: string;
}
interface RouteSummary {
  amountOut: string;
  gasUsd: string;
  extraFee?: { feeAmount: string; chargeFeeBy: string; feeReceiver: string };
  route?: Hop[][];
}

/**
 * KyberSwap Aggregator: keyless, same-chain EVM. Our fee rides as extraFee (bps of output,
 * charged by the router to feeReceiver). Measured: sum of last-hop outputs minus net amountOut.
 */
export function kyberswap(
  pricer: Pricer,
  env: NodeJS.ProcessEnv,
  f: Fetch = fetch,
): ProviderAdapter {
  const feeBps = Number(env.SWAPCHAN_FEE_BPS ?? 0);
  const recipient = env.SWAPCHAN_FEE_RECIPIENT;
  const headers = { "x-client-id": env.KYBER_CLIENT_ID || "SwapChan" };
  return {
    name: "kyberswap",
    enabled: () => true,
    supports: (r) =>
      isEvmChain(r.fromChainId) && r.fromChainId === r.toChainId && r.fromChainId in SLUG,
    async quote(req: QuoteRequest, signal) {
      const slug = SLUG[req.fromChainId];
      const q = new URLSearchParams({
        tokenIn: toKyber(req.fromToken),
        tokenOut: toKyber(req.toToken),
        amountIn: req.amount,
        source: "SwapChan",
      });
      if (recipient && feeBps > 0) {
        q.set("feeAmount", String(feeBps));
        q.set("chargeFeeBy", "currency_out");
        q.set("isInBps", "true");
        q.set("feeReceiver", recipient);
      }
      const r = await getJson<{
        code: number;
        message: string;
        data?: { routeSummary: RouteSummary; routerAddress: string };
      }>(f, `${BASE}/${slug}/api/v1/routes?${q}`, { headers, signal });
      if (!r.data) throw new Error(r.message || "no route");
      const s = r.data.routeSummary;
      const out = BigInt(s.amountOut);
      const gross = (s.route ?? []).reduce(
        (acc, path) => acc + BigInt(path[path.length - 1]?.amountOut ?? "0"),
        0n,
      );
      const echoed =
        !!recipient &&
        s.extraFee?.feeReceiver?.toLowerCase() === recipient.toLowerCase() &&
        Number(s.extraFee.feeAmount) > 0;
      const feeRaw = echoed && gross > out ? gross - out : 0n;
      const ourFeeUsd =
        feeRaw > 0n ? ((await pricer.usd(req.toChainId, req.toToken, feeRaw)) ?? 0) : 0;
      const outUsd = await pricer.usd(req.toChainId, req.toToken, out);
      const gasUsd = Number(s.gasUsd ?? 0);
      let tx: Quote["tx"] = null;
      if (req.taker) {
        const b = await getJson<{
          data?: { data: string; routerAddress: string; transactionValue: string; gas?: string };
          message?: string;
        }>(f, `${BASE}/${slug}/api/v1/route/build`, {
          method: "POST",
          signal,
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            routeSummary: s,
            sender: req.taker,
            recipient: req.taker,
            slippageTolerance: req.slippageBps,
            source: "SwapChan",
          }),
        });
        if (!b.data) throw new Error(b.message || "build failed");
        tx = {
          chainId: req.fromChainId,
          to: b.data.routerAddress as `0x${string}`,
          data: b.data.data as `0x${string}`,
          value: b.data.transactionValue || "0",
          ...(b.data.gas ? { gasLimit: String(BigInt(b.data.gas) + BigInt(b.data.gas) / 5n) } : {}),
        };
      }
      const tools = [...new Set((s.route ?? []).flatMap((p) => p.map((h) => h.exchange)))];
      const native = toKyber(req.fromToken) === KYBER_NATIVE;
      return Quote.parse({
        id: `kyberswap:${crypto.randomUUID()}`,
        provider: "kyberswap",
        request: req,
        toAmount: out.toString(),
        toAmountMin: ((out * BigInt(10_000 - req.slippageBps)) / 10_000n).toString(),
        gasUsd,
        feeUsd: ourFeeUsd,
        netUsd: outUsd === null ? null : outUsd - gasUsd,
        etaSeconds: 15,
        steps: [
          {
            type: "swap",
            tool: tools.join("+") || "kyberswap",
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: out.toString(),
          },
        ],
        approvalAddress: native ? null : r.data.routerAddress,
        tx,
        expiresAt: Date.now() + 30_000,
        ourFeeUsd,
        ourFeeVerified: feeRaw > 0n,
        ...(recipient && feeRaw > 0n
          ? { feeRecipient: { address: recipient, chainId: req.fromChainId } }
          : {}),
      });
    },
  };
}
