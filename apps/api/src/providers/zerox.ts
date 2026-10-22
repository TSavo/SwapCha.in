import { type BuildResponse, Quote, type QuoteRequest, TypedData } from "@swapchan/shared";
import { type Pricer, ZERO_ADDRESS } from "../pricing.js";
import { type Fetch, getJson, type ProviderAdapter } from "./types.js";

const BASE = "https://api.0x.org/swap";

interface ZeroXQuote {
  buyAmount: string;
  minBuyAmount: string;
  totalNetworkFee?: string | null;
  fees?: { integratorFee?: { amount: string; token: string } | null };
  issues?: { allowance?: { spender: string } | null };
  route?: { fills?: { source: string }[] };
  transaction?: { to: string; data: string; value: string; gas?: string };
  permit2?: { eip712: unknown } | null;
}

/** 0x Swap API v2: same-chain only. Needs ZEROX_API_KEY. */
export function zerox(env: NodeJS.ProcessEnv, pricer: Pricer, f: Fetch = fetch): ProviderAdapter {
  const key = env.ZEROX_API_KEY;
  const call = (path: string, req: QuoteRequest, signal: AbortSignal) => {
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
    return getJson<ZeroXQuote>(f, `${BASE}/${path}?${q}`, {
      headers: { "0x-api-key": key ?? "", "0x-version": "v2" },
      signal,
    });
  };
  return {
    name: "0x",
    enabled: () => Boolean(key),
    supports: (r) => r.fromChainId === r.toChainId,
    async quote(req, signal) {
      const r = await call(
        req.taker ? "allowance-holder/quote" : "allowance-holder/price",
        req,
        signal,
      );
      const [outUsd, gasUsd] = await Promise.all([
        pricer.usd(req.toChainId, req.toToken, r.buyAmount),
        r.totalNetworkFee
          ? pricer.usd(req.fromChainId, ZERO_ADDRESS, r.totalNetworkFee)
          : Promise.resolve(0),
      ]);
      const ourFee = r.fees?.integratorFee;
      const ourFeeUsd = ourFee
        ? ((await pricer.usd(req.toChainId, ourFee.token, ourFee.amount)) ?? 0)
        : 0;
      const t = r.transaction;
      return Quote.parse({
        id: `0x:${crypto.randomUUID()}`,
        provider: "0x",
        request: req,
        toAmount: r.buyAmount,
        toAmountMin: r.minBuyAmount,
        gasUsd: gasUsd ?? 0,
        feeUsd: 0,
        netUsd: outUsd === null ? null : outUsd - (gasUsd ?? 0),
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
        ourFeeUsd,
        ourFeeVerified: BigInt(ourFee?.amount ?? "0") > 0n,
      });
    },
    /** Build via 0x Permit2 flow: returns tx + Permit2 typed data (sign it, append sig per 0x docs). */
    async build(req, signal): Promise<BuildResponse> {
      const r = await call("permit2/quote", req, signal);
      const t = r.transaction;
      if (!t) throw new Error("0x returned no transaction");
      return {
        chainId: req.fromChainId,
        to: t.to as `0x${string}`,
        data: t.data as `0x${string}`,
        value: t.value,
        ...(t.gas ? { gasLimit: t.gas } : {}),
        ...(r.permit2 ? { permit2: TypedData.parse(r.permit2.eip712) } : {}),
      };
    },
  };
}
