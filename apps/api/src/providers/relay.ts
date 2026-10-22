import { NATIVE_TOKEN, Quote, type QuoteRequest, StatusResponse } from "@swapchan/shared";
import { ZERO_ADDRESS } from "../pricing.js";
import { type Fetch, getJson, PLACEHOLDER_TAKER, type ProviderAdapter } from "./types.js";

const BASE = "https://api.relay.link";
const toRelay = (a: string) => (a.toLowerCase() === NATIVE_TOKEN.toLowerCase() ? ZERO_ADDRESS : a);
interface Amt {
  amount: string;
  amountUsd?: string;
  minimumAmount?: string;
}
interface RelayQuote {
  requestId?: string;
  steps: {
    id: string;
    requestId?: string;
    kind: string;
    items: { data?: { to: string; data: string; value: string; chainId: number; gas?: string } }[];
  }[];
  fees: Record<string, Amt | undefined>;
  details: { currencyOut: Amt; timeEstimate?: number };
}

/** Relay: keyless (RELAY_API_KEY optional), same- and cross-chain. */
export function relay(env: NodeJS.ProcessEnv, f: Fetch = fetch): ProviderAdapter {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(env.RELAY_API_KEY ? { "x-api-key": env.RELAY_API_KEY } : {}),
  };
  return {
    name: "relay",
    enabled: () => true,
    supports: () => true,
    async quote(req: QuoteRequest, signal) {
      const r = await getJson<RelayQuote>(f, `${BASE}/quote`, {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify({
          user: req.taker ?? PLACEHOLDER_TAKER,
          originChainId: req.fromChainId,
          destinationChainId: req.toChainId,
          originCurrency: toRelay(req.fromToken),
          destinationCurrency: toRelay(req.toToken),
          amount: req.amount,
          tradeType: "EXACT_INPUT",
          slippageTolerance: String(req.slippageBps),
          ...(env.RELAY_API_KEY ? { referrer: "swapchan" } : {}), // referrer requires a key
          ...(env.SWAPCHAN_FEE_RECIPIENT && Number(env.SWAPCHAN_FEE_BPS) > 0
            ? {
                appFees: [
                  { recipient: env.SWAPCHAN_FEE_RECIPIENT, fee: String(env.SWAPCHAN_FEE_BPS) },
                ],
              }
            : {}),
        }),
      });
      const out = r.details.currencyOut;
      const gasUsd = Number(r.fees.gas?.amountUsd ?? 0);
      const feeUsd = Number(r.fees.relayer?.amountUsd ?? 0) + Number(r.fees.app?.amountUsd ?? 0);
      const main = r.steps.find((s) => s.id !== "approve")?.items[0]?.data;
      const approve = r.steps.find((s) => s.id === "approve")?.items[0]?.data;
      return Quote.parse({
        id: `relay:${r.requestId ?? r.steps[0]?.requestId ?? crypto.randomUUID()}`,
        provider: "relay",
        request: req,
        toAmount: out.amount,
        toAmountMin: out.minimumAmount ?? out.amount,
        gasUsd,
        feeUsd,
        netUsd: out.amountUsd ? Number(out.amountUsd) - gasUsd : null, // currencyOut already net of relayer fees
        etaSeconds: r.details.timeEstimate ?? 10,
        steps: [
          {
            type: req.fromChainId === req.toChainId ? "swap" : "bridge",
            tool: "relay",
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: out.amount,
          },
        ],
        // Relay's approve step targets the token; spender is encoded in its calldata (bytes 4..36).
        approvalAddress: approve ? (`0x${approve.data.slice(34, 74)}` as const) : null,
        tx:
          req.taker && main
            ? {
                chainId: main.chainId,
                to: main.to,
                data: main.data,
                value: main.value ?? "0",
                ...(main.gas ? { gasLimit: main.gas } : {}),
              }
            : null,
        expiresAt: Date.now() + 30_000,
      });
    },
    async status(req, signal) {
      const r = await getJson<{
        requests?: { status: string; data?: { outTxs?: { hash: string }[] } }[];
      }>(f, `${BASE}/requests/v2?hash=${req.txHash}`, { headers, signal });
      const x = r.requests?.[0];
      const map: Record<string, StatusResponse["status"]> = {
        success: "done",
        failure: "failed",
        refund: "failed",
      };
      return StatusResponse.parse({
        status: x ? (map[x.status] ?? "pending") : "not_found",
        receivingTxHash: x?.data?.outTxs?.[0]?.hash ?? null,
      });
    },
  };
}
