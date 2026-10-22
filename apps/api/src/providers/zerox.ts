import { Quote, type QuoteRequest } from "@swapchan/shared";
import { type Fetch, getJson, type ProviderAdapter } from "./types.js";

const BASE = "https://api.0x.org/swap/allowance-holder";

interface ZeroXQuote {
  buyAmount: string;
  minBuyAmount: string;
  issues?: { allowance?: { spender: string } | null };
  route?: { fills?: { source: string; from: string; to: string }[] };
  transaction?: { to: string; data: string; value: string; gas?: string };
}

/** 0x Swap API v2: same-chain only. Needs ZEROX_API_KEY. */
export function zerox(env: NodeJS.ProcessEnv, f: Fetch = fetch): ProviderAdapter {
  const key = env.ZEROX_API_KEY;
  return {
    name: "0x",
    enabled: () => Boolean(key),
    supports: (r) => r.fromChainId === r.toChainId,
    async quote(req: QuoteRequest, signal) {
      const q = new URLSearchParams({
        chainId: String(req.fromChainId),
        sellToken: req.fromToken,
        buyToken: req.toToken,
        sellAmount: req.amount,
        slippageBps: String(req.slippageBps),
      });
      if (req.taker) q.set("taker", req.taker);
      if (env.SWAPCHAN_FEE_RECIPIENT && Number(env.SWAPCHAN_FEE_BPS) > 0) {
        q.set("swapFeeRecipient", env.SWAPCHAN_FEE_RECIPIENT);
        q.set("swapFeeBps", String(env.SWAPCHAN_FEE_BPS));
        q.set("swapFeeToken", req.toToken);
      }
      const ep = req.taker ? "quote" : "price";
      const r = await getJson<ZeroXQuote>(f, `${BASE}/${ep}?${q}`, {
        headers: { "0x-api-key": key ?? "", "0x-version": "v2" },
        signal,
      });
      const t = r.transaction;
      return Quote.parse({
        id: `0x:${crypto.randomUUID()}`,
        provider: "0x",
        request: req,
        toAmount: r.buyAmount,
        toAmountMin: r.minBuyAmount,
        gasUsd: 0,
        feeUsd: 0,
        netUsd: null,
        etaSeconds: 15,
        steps: [
          {
            type: "swap",
            tool: (r.route?.fills ?? []).map((x) => x.source).join("+") || "0x",
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: r.buyAmount,
          },
        ],
        approvalAddress: r.issues?.allowance?.spender ?? null,
        tx:
          req.taker && t
            ? {
                chainId: req.fromChainId,
                to: t.to,
                data: t.data,
                value: t.value,
                ...(t.gas ? { gasLimit: t.gas } : {}),
              }
            : null,
        expiresAt: Date.now() + 30_000,
      });
    },
  };
}
