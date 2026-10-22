import { isEvmChain, Quote, type QuoteRequest } from "@swapchan/shared";
import type { Pricer } from "../pricing.js";
import { type Fetch, getJson, type ProviderAdapter } from "./types.js";

const BASE = "https://api.paraswap.io";
interface PriceRoute {
  destAmount: string;
  gasCostUSD: string;
  destUSD: string;
  tokenTransferProxy: string;
  bestRoute?: { swaps?: { swapExchanges?: { exchange: string }[] }[] }[];
}

/** Velora (ParaSwap): keyless, same-chain. */
export function velora(pricer: Pricer, env: NodeJS.ProcessEnv, f: Fetch = fetch): ProviderAdapter {
  const headers: Record<string, string> = env.VELORA_API_KEY
    ? { "X-API-KEY": env.VELORA_API_KEY }
    : {};
  const feeBps = Number(env.SWAPCHAN_FEE_BPS ?? 0);
  const fee: Record<string, string> =
    env.SWAPCHAN_FEE_RECIPIENT && feeBps > 0
      ? { partnerAddress: env.SWAPCHAN_FEE_RECIPIENT, partnerFeeBps: String(feeBps) }
      : {};
  return {
    name: "velora",
    enabled: () => true,
    supports: (r) =>
      isEvmChain(r.fromChainId) && isEvmChain(r.toChainId) && r.fromChainId === r.toChainId,
    async quote(req: QuoteRequest, signal) {
      const [src, dst] = await Promise.all([
        pricer.token(req.fromChainId, req.fromToken),
        pricer.token(req.toChainId, req.toToken),
      ]);
      if (!src || !dst) throw new Error("unknown token decimals");
      const q = new URLSearchParams({
        srcToken: req.fromToken,
        destToken: req.toToken,
        amount: req.amount,
        srcDecimals: String(src.decimals),
        destDecimals: String(dst.decimals),
        side: "SELL",
        network: String(req.fromChainId),
        version: "6.2",
        partner: "swapchan",
        ...fee,
      });
      const { priceRoute } = await getJson<{ priceRoute: PriceRoute }>(f, `${BASE}/prices?${q}`, {
        headers,
        signal,
      });
      // Velora takes the partner fee from the output at execution; /prices' destAmount is before it.
      const cutBps = fee.partnerFeeBps ? BigInt(feeBps) : 0n;
      const out = (BigInt(priceRoute.destAmount) * (10_000n - cutBps)) / 10_000n;
      const partnerFeeUsd = (Number(priceRoute.destUSD) * Number(cutBps)) / 10_000;
      const minOut = (out * BigInt(10_000 - req.slippageBps)) / 10_000n;
      let tx: Quote["tx"] = null;
      if (req.taker) {
        const t = await getJson<{
          to: string;
          data: string;
          value: string;
          gas?: string;
          chainId: number;
        }>(f, `${BASE}/transactions/${req.fromChainId}?ignoreChecks=true`, {
          method: "POST",
          signal,
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            srcToken: req.fromToken,
            destToken: req.toToken,
            srcAmount: req.amount,
            ...fee,
            slippage: req.slippageBps,
            priceRoute,
            userAddress: req.taker,
            partner: "swapchan",
          }),
        });
        tx = {
          chainId: req.fromChainId,
          to: t.to as `0x${string}`,
          data: t.data as `0x${string}`,
          value: t.value,
          ...(t.gas ? { gasLimit: t.gas } : {}),
        };
      }
      const gasUsd = Number(priceRoute.gasCostUSD);
      const tools = [
        ...new Set(
          priceRoute.bestRoute?.flatMap(
            (r) => r.swaps?.flatMap((s) => s.swapExchanges?.map((e) => e.exchange) ?? []) ?? [],
          ) ?? [],
        ),
      ];
      return Quote.parse({
        id: `velora:${crypto.randomUUID()}`,
        provider: "velora",
        request: req,
        toAmount: out.toString(),
        toAmountMin: minOut.toString(),
        gasUsd,
        feeUsd: partnerFeeUsd,
        netUsd: Number(priceRoute.destUSD) - partnerFeeUsd - gasUsd,
        etaSeconds: 15,
        steps: [
          {
            type: "swap",
            tool: tools.join("+") || "velora",
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: out.toString(),
          },
        ],
        approvalAddress: priceRoute.tokenTransferProxy,
        tx,
        ourFeeUsd: partnerFeeUsd,
        ourFeeVerified: partnerFeeUsd > 0,
        expiresAt: Date.now() + 30_000,
      });
    },
  };
}
