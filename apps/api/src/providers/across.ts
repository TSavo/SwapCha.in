import { Quote, type QuoteRequest, StatusResponse } from "@swapchan/shared";
import type { Pricer } from "../pricing.js";
import { type Fetch, getJson, PLACEHOLDER_TAKER, type ProviderAdapter } from "./types.js";

interface AcrossSwap {
  id: string;
  expectedOutputAmount: string;
  minOutputAmount: string;
  expectedFillTime: number;
  quoteExpiryTimestamp: number;
  checks?: { allowance?: { spender: string } };
  swapTx: { chainId: number; to: string; data: string; value?: string; gas?: string };
}

/** Across: keyless, cross-chain only (intent bridge with optional origin/dest swaps). */
export function across(pricer: Pricer, f: Fetch = fetch): ProviderAdapter {
  return {
    name: "across",
    enabled: () => true,
    supports: (r) => r.fromChainId !== r.toChainId,
    async quote(req: QuoteRequest, signal) {
      const q = new URLSearchParams({
        tradeType: "exactInput",
        amount: req.amount,
        inputToken: req.fromToken,
        outputToken: req.toToken,
        originChainId: String(req.fromChainId),
        destinationChainId: String(req.toChainId),
        depositor: req.taker ?? PLACEHOLDER_TAKER,
        slippage: String(req.slippageBps / 10_000),
        integratorId: "0x0000",
      });
      const r = await getJson<AcrossSwap>(f, `https://app.across.to/api/swap/approval?${q}`, {
        signal,
      });
      const [inUsd, outUsd] = await Promise.all([
        pricer.usd(req.fromChainId, req.fromToken, req.amount),
        pricer.usd(req.toChainId, req.toToken, r.expectedOutputAmount),
      ]);
      const t = r.swapTx;
      return Quote.parse({
        id: `across:${r.id}`,
        provider: "across",
        request: req,
        toAmount: r.expectedOutputAmount,
        toAmountMin: r.minOutputAmount,
        gasUsd: 0,
        feeUsd: inUsd !== null && outUsd !== null ? Math.max(0, inUsd - outUsd) : 0,
        netUsd: outUsd,
        etaSeconds: r.expectedFillTime,
        steps: [
          {
            type: "bridge",
            tool: "across",
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: r.expectedOutputAmount,
          },
        ],
        approvalAddress: r.checks?.allowance?.spender ?? null,
        tx: req.taker
          ? {
              chainId: t.chainId,
              to: t.to,
              data: t.data,
              value: t.value ?? "0",
              ...(t.gas ? { gasLimit: t.gas } : {}),
            }
          : null,
        expiresAt: r.quoteExpiryTimestamp * 1000,
      });
    },
    async status(req, signal) {
      const q = new URLSearchParams({
        originChainId: String(req.fromChainId),
        depositTxnRef: req.txHash,
      });
      let r: { status?: string; fillTx?: string; fillTxnRef?: string };
      try {
        r = await getJson(f, `https://app.across.to/api/deposit/status?${q}`, { signal });
      } catch (e) {
        if (/DepositNotFound|404/.test(String(e)))
          return { status: "not_found", receivingTxHash: null };
        throw e;
      }
      const map: Record<string, StatusResponse["status"]> = {
        filled: "done",
        expired: "failed",
        refunded: "failed",
      };
      return StatusResponse.parse({
        status: map[r.status ?? ""] ?? "pending",
        receivingTxHash: r.fillTxnRef ?? r.fillTx ?? null,
      });
    },
  };
}
