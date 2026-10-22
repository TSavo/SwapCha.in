import { isEvmChain, NATIVE_TOKEN, Quote, type QuoteRequest } from "@swapchan/shared";
import type { Pricer } from "../pricing.js";
import { type Fetch, getJson, PLACEHOLDER_TAKER, type ProviderAdapter } from "./types.js";

const NETWORK: Record<number, string> = {
  1: "mainnet",
  8453: "base",
  42161: "arbitrum_one",
  137: "polygon",
  56: "bnb",
  43114: "avalanche",
  59144: "linea",
};
export const COW_VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";
const SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";

interface CowQuote {
  id: number | null;
  quote: {
    sellToken: string;
    buyToken: string;
    receiver?: string | null;
    sellAmount: string;
    buyAmount: string;
    validTo: number;
    appData: string;
    appDataHash?: string;
    feeAmount: string;
    kind: string;
    partiallyFillable: boolean;
    sellTokenBalance: string;
    buyTokenBalance: string;
  };
}

/** CoW Protocol: keyless, same-chain, intent-based (sign EIP-712 order, no tx, gas paid by solvers). */
/** CoW appData carrying our partner fee (volume-based, taken from the buy token at settlement). */
export function cowAppData(recipient: string | undefined, bps: number): string {
  const metadata = recipient && bps > 0 ? { partnerFee: { volumeBps: bps, recipient } } : {};
  return JSON.stringify({ appCode: "SwapChan", metadata, version: "1.4.0" });
}

export function cow(
  pricer: Pricer,
  f: Fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): ProviderAdapter {
  const feeBps = env.SWAPCHAN_FEE_RECIPIENT ? Number(env.SWAPCHAN_FEE_BPS ?? 0) : 0;
  const appData = cowAppData(env.SWAPCHAN_FEE_RECIPIENT, feeBps);
  const uploaded = new Set<string>();
  return {
    name: "cow",
    enabled: () => true,
    supports: (r) =>
      r.fromChainId === r.toChainId &&
      r.fromChainId in NETWORK &&
      isEvmChain(r.fromChainId) &&
      r.fromToken.toLowerCase() !== NATIVE_TOKEN.toLowerCase(),
    async quote(req: QuoteRequest, signal) {
      const net = NETWORK[req.fromChainId];
      const from = req.taker ?? PLACEHOLDER_TAKER;
      const r = await getJson<CowQuote>(f, `https://api.cow.fi/${net}/api/v1/quote`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sellToken: req.fromToken,
          buyToken: req.toToken,
          from,
          kind: "sell",
          sellAmountBeforeFee: req.amount,
          appData,
        }),
      });
      const q = r.quote;
      const hash = q.appDataHash ?? q.appData;
      // Register the full appData doc so orders signed with its hash carry our partner fee.
      if (feeBps > 0 && hash.startsWith("0x") && !uploaded.has(`${net}:${hash}`)) {
        const put = await f(`https://api.cow.fi/${net}/api/v1/app_data/${hash}`, {
          method: "PUT",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fullAppData: appData }),
        });
        if (put.ok) uploaded.add(`${net}:${hash}`);
      }
      // Partner fee is taken from the buy token at settlement: quote out net of it, then slippage.
      const buyNet = (BigInt(q.buyAmount) * BigInt(10_000 - feeBps)) / 10_000n;
      const ourFeeAmt = BigInt(q.buyAmount) - buyNet;
      const minBuy = (buyNet * BigInt(10_000 - req.slippageBps)) / 10_000n;
      const [buyUsd, feeUsd, ourFeeUsd] = await Promise.all([
        pricer.usd(req.toChainId, req.toToken, buyNet.toString()),
        pricer.usd(req.fromChainId, req.fromToken, q.feeAmount),
        ourFeeAmt > 0n ? pricer.usd(req.toChainId, req.toToken, ourFeeAmt.toString()) : 0,
      ]);
      return Quote.parse({
        id: `cow:${r.id ?? crypto.randomUUID()}`,
        provider: "cow",
        request: req,
        toAmount: buyNet.toString(),
        toAmountMin: minBuy.toString(),
        gasUsd: 0,
        feeUsd: feeUsd ?? 0,
        netUsd: buyUsd, // buyAmount is already net of the network fee
        etaSeconds: 60,
        steps: [
          {
            type: "swap",
            tool: "cow",
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: buyNet.toString(),
          },
        ],
        approvalAddress: COW_VAULT_RELAYER,
        tx: null,
        expiresAt: q.validTo * 1000,
        ourFeeUsd: ourFeeUsd ?? 0,
        // Verified = CoW echoed our partnerFee appData back on the quote.
        ourFeeVerified: ourFeeAmt > 0n && q.appData.includes("partnerFee"),
        execution: "order",
        order: {
          domain: {
            name: "Gnosis Protocol",
            version: "v2",
            chainId: req.fromChainId,
            verifyingContract: SETTLEMENT,
          },
          primaryType: "Order",
          types: {
            Order: [
              { name: "sellToken", type: "address" },
              { name: "buyToken", type: "address" },
              { name: "receiver", type: "address" },
              { name: "sellAmount", type: "uint256" },
              { name: "buyAmount", type: "uint256" },
              { name: "validTo", type: "uint32" },
              { name: "appData", type: "bytes32" },
              { name: "feeAmount", type: "uint256" },
              { name: "kind", type: "string" },
              { name: "partiallyFillable", type: "bool" },
              { name: "sellTokenBalance", type: "string" },
              { name: "buyTokenBalance", type: "string" },
            ],
          },
          // Fee-less order (fee folded into sellAmount), per current CoW API.
          message: {
            sellToken: q.sellToken,
            buyToken: q.buyToken,
            receiver: from,
            validTo: q.validTo,
            appData: hash,
            kind: q.kind,
            partiallyFillable: q.partiallyFillable,
            sellTokenBalance: q.sellTokenBalance,
            buyTokenBalance: q.buyTokenBalance,
            sellAmount: (BigInt(q.sellAmount) + BigInt(q.feeAmount)).toString(),
            buyAmount: minBuy.toString(),
            feeAmount: "0",
          },
        },
      });
    },
  };
}
