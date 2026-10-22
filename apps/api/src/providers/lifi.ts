import { Quote, type QuoteRequest, StatusResponse } from "@swapchan/shared";
import { type Fetch, getJson, type ProviderAdapter } from "./types.js";

const BASE = "https://li.quest/v1";
/** LI.FI requires fromAddress even for indicative quotes. */
const PLACEHOLDER_TAKER = "0x0000000000000000000000000000000000000001";

interface LifiStep {
  id: string;
  type: string;
  tool: string;
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: { address: string };
    toToken: { address: string };
    fromAmount: string;
  };
  estimate: {
    toAmount: string;
    toAmountMin: string;
    toAmountUSD?: string;
    approvalAddress?: string;
    executionDuration: number;
    gasCosts?: { amountUSD?: string }[];
    feeCosts?: { amountUSD?: string; included?: boolean }[];
  };
  includedSteps?: LifiStep[];
  transactionRequest?: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
    chainId: number;
  };
}

const sumUsd = (xs: { amountUSD?: string; included?: boolean }[] = []) =>
  xs.filter((x) => !x.included).reduce((a, x) => a + Number(x.amountUSD ?? 0), 0);

const hexToDec = (v: string | undefined) => (v ? BigInt(v).toString() : undefined);

export function lifi(env: NodeJS.ProcessEnv, f: Fetch = fetch): ProviderAdapter {
  const headers: Record<string, string> = env.LIFI_API_KEY
    ? { "x-lifi-api-key": env.LIFI_API_KEY }
    : {};
  const feeBps = Number(env.SWAPCHAN_FEE_BPS ?? 0);
  return {
    name: "lifi",
    enabled: () => true,
    supports: () => true,
    async quote(req: QuoteRequest, signal) {
      const q = new URLSearchParams({
        fromChain: String(req.fromChainId),
        toChain: String(req.toChainId),
        fromToken: req.fromToken,
        toToken: req.toToken,
        fromAmount: req.amount,
        fromAddress: req.taker ?? PLACEHOLDER_TAKER,
        slippage: String(req.slippageBps / 10_000),
        integrator: "swapchan",
      });
      if (feeBps > 0) q.set("fee", String(feeBps / 10_000));
      const s = await getJson<LifiStep>(f, `${BASE}/quote?${q}`, { headers, signal });
      const gasUsd = sumUsd(s.estimate.gasCosts);
      const feeUsd = sumUsd(s.estimate.feeCosts);
      const toUsd = s.estimate.toAmountUSD ? Number(s.estimate.toAmountUSD) : null;
      const tr = s.transactionRequest;
      const gasLimit = hexToDec(tr?.gasLimit);
      return Quote.parse({
        id: `lifi:${s.id}`,
        provider: "lifi",
        request: req,
        toAmount: s.estimate.toAmount,
        toAmountMin: s.estimate.toAmountMin,
        gasUsd,
        feeUsd,
        netUsd: toUsd === null ? null : toUsd - gasUsd - feeUsd,
        etaSeconds: Math.round(s.estimate.executionDuration),
        steps: (s.includedSteps ?? [s]).map((st) => ({
          type:
            st.type === "cross"
              ? "bridge"
              : st.tool === "feeCollection"
                ? "fee"
                : st.type === "protocol"
                  ? "wrap"
                  : "swap",
          tool: st.tool,
          fromChainId: st.action.fromChainId,
          toChainId: st.action.toChainId,
          fromToken: st.action.fromToken.address,
          toToken: st.action.toToken.address,
          fromAmount: st.action.fromAmount,
          toAmount: st.estimate.toAmount,
        })),
        approvalAddress: s.estimate.approvalAddress ?? null,
        tx:
          req.taker && tr
            ? {
                chainId: tr.chainId,
                to: tr.to,
                data: tr.data,
                value: hexToDec(tr.value) ?? "0",
                ...(gasLimit ? { gasLimit } : {}),
              }
            : null,
        expiresAt: Date.now() + 60_000,
      });
    },
    async status(req, signal) {
      const q = new URLSearchParams({
        txHash: req.txHash,
        fromChain: String(req.fromChainId),
        toChain: String(req.toChainId),
      });
      const r = await getJson<{ status: string; receiving?: { txHash?: string } }>(
        f,
        `${BASE}/status?${q}`,
        { headers, signal },
      );
      const map: Record<string, StatusResponse["status"]> = {
        DONE: "done",
        FAILED: "failed",
        NOT_FOUND: "not_found",
      };
      return StatusResponse.parse({
        status: map[r.status] ?? "pending",
        receivingTxHash: r.receiving?.txHash ?? null,
      });
    },
  };
}
