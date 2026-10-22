import { NATIVE_TOKEN, Quote, type QuoteRequest } from "@swapchan/shared";
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
    feeAmount: string;
    kind: string;
    partiallyFillable: boolean;
    sellTokenBalance: string;
    buyTokenBalance: string;
  };
}

/** CoW Protocol: keyless, same-chain, intent-based (sign EIP-712 order, no tx, gas paid by solvers). */
export function cow(pricer: Pricer, f: Fetch = fetch): ProviderAdapter {
  return {
    name: "cow",
    enabled: () => true,
    supports: (r) =>
      r.fromChainId === r.toChainId &&
      r.fromChainId in NETWORK &&
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
        }),
      });
      const q = r.quote;
      // Slippage applied to buyAmount for the signed order.
      const minBuy = (BigInt(q.buyAmount) * BigInt(10_000 - req.slippageBps)) / 10_000n;
      const [buyUsd, feeUsd] = await Promise.all([
        pricer.usd(req.toChainId, req.toToken, q.buyAmount),
        pricer.usd(req.fromChainId, req.fromToken, q.feeAmount),
      ]);
      return Quote.parse({
        id: `cow:${r.id ?? crypto.randomUUID()}`,
        provider: "cow",
        request: req,
        toAmount: q.buyAmount,
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
            toAmount: q.buyAmount,
          },
        ],
        approvalAddress: COW_VAULT_RELAYER,
        tx: null,
        expiresAt: q.validTo * 1000,
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
            appData: q.appData,
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
