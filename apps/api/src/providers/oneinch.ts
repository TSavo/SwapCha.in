import { isEvmChain, Quote, type QuoteRequest } from "@swapchan/shared";
import { type Pricer, ZERO_ADDRESS } from "../pricing.js";
import { type Fetch, getJson, type ProviderAdapter } from "./types.js";

const BASE = "https://api.1inch.dev/swap/v6.1";
/** 1inch AggregationRouterV6: same address on every supported chain. */
const ROUTER = "0x111111125421cA6dc452d289314280a0f8842A65";
const CHAINS = new Set([1, 8453, 42161, 10, 137, 56, 43114, 59144]);
const ONEINCH_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const to1inch = (a: string) => (a.toLowerCase() === ZERO_ADDRESS ? ONEINCH_NATIVE : a);

/**
 * 1inch Swap API (classic). Needs ONEINCH_API_KEY (portal.1inch.dev). Our fee: `fee` (percent
 * of the input) paid to `referrer`. Measured by quoting once with and once without the fee.
 */
export function oneinch(pricer: Pricer, env: NodeJS.ProcessEnv, f: Fetch = fetch): ProviderAdapter {
  const key = env.ONEINCH_API_KEY;
  const feeBps = Number(env.SWAPCHAN_FEE_BPS ?? 0);
  const referrer = env.SWAPCHAN_FEE_RECIPIENT;
  const headers = { Authorization: `Bearer ${key ?? ""}`, accept: "application/json" };
  const params = (req: QuoteRequest, withFee: boolean) => {
    const q = new URLSearchParams({
      src: to1inch(req.fromToken),
      dst: to1inch(req.toToken),
      amount: req.amount,
      includeGas: "true",
      includeProtocols: "true",
    });
    if (withFee && referrer && feeBps > 0) q.set("fee", String(feeBps / 100));
    return q;
  };
  return {
    name: "1inch",
    enabled: () => Boolean(key),
    supports: (r) =>
      isEvmChain(r.fromChainId) && r.fromChainId === r.toChainId && CHAINS.has(r.fromChainId),
    async quote(req, signal) {
      const c = req.fromChainId;
      const [withFee, noFee] = await Promise.all([
        getJson<{ dstAmount: string; gas?: number }>(f, `${BASE}/${c}/quote?${params(req, true)}`, {
          headers,
          signal,
        }),
        referrer && feeBps > 0
          ? getJson<{ dstAmount: string }>(f, `${BASE}/${c}/quote?${params(req, false)}`, {
              headers,
              signal,
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const out = BigInt(withFee.dstAmount);
      const feeRaw = noFee && BigInt(noFee.dstAmount) > out ? BigInt(noFee.dstAmount) - out : 0n;
      let tx: Quote["tx"] = null;
      if (req.taker) {
        const q = params(req, true);
        q.set("from", req.taker);
        q.set("origin", req.taker);
        q.set("slippage", String(req.slippageBps / 100));
        q.set("disableEstimate", "true");
        if (referrer && feeBps > 0) q.set("referrer", referrer);
        const s = await getJson<{ tx: { to: string; data: string; value: string; gas?: number } }>(
          f,
          `${BASE}/${c}/swap?${q}`,
          { headers, signal },
        );
        tx = {
          chainId: c,
          to: s.tx.to as `0x${string}`,
          data: s.tx.data as `0x${string}`,
          value: s.tx.value,
          ...(s.tx.gas ? { gasLimit: String(s.tx.gas) } : {}),
        };
      }
      const [outUsd, ourFeeUsd] = await Promise.all([
        pricer.usd(req.toChainId, req.toToken, out),
        feeRaw > 0n ? pricer.usd(req.toChainId, req.toToken, feeRaw) : Promise.resolve(0),
      ]);
      const native = to1inch(req.fromToken) === ONEINCH_NATIVE;
      return Quote.parse({
        id: `1inch:${crypto.randomUUID()}`,
        provider: "1inch",
        request: req,
        toAmount: out.toString(),
        toAmountMin: ((out * BigInt(10_000 - req.slippageBps)) / 10_000n).toString(),
        gasUsd: 0,
        feeUsd: ourFeeUsd ?? 0,
        netUsd: outUsd,
        etaSeconds: 15,
        steps: [
          {
            type: "swap",
            tool: "1inch",
            fromChainId: c,
            toChainId: c,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: out.toString(),
          },
        ],
        approvalAddress: native ? null : ROUTER,
        tx,
        expiresAt: Date.now() + 30_000,
        ourFeeUsd: ourFeeUsd ?? 0,
        ourFeeVerified: feeRaw > 0n,
        ...(referrer && feeRaw > 0n ? { feeRecipient: { address: referrer, chainId: c } } : {}),
      });
    },
  };
}
