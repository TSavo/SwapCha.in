import {
  BITCOIN,
  NON_EVM,
  type NonEvmTx,
  Quote,
  type QuoteRequest,
  SOLANA,
  StatusResponse,
  vmOf,
} from "@swapchan/shared";
import { type Fetch, getJson, type ProviderAdapter, placeholderFor } from "./types.js";

/** Our chain ids (Relay numbering) <-> LI.FI's. Tron matches. */
const TO_LIFI: Record<number, number> = { [SOLANA]: 1151111081099710, [BITCOIN]: 20000000000001 };
const FROM_LIFI: Record<number, number> = Object.fromEntries(
  Object.entries(TO_LIFI).map(([a, b]) => [b, Number(a)]),
);
export const lifiChain = (id: number) => TO_LIFI[id] ?? id;
const ourChain = (id: number) => FROM_LIFI[id] ?? id;
const lifiToken = (chainId: number, a: string) =>
  chainId === BITCOIN && a === NON_EVM[BITCOIN]?.native ? "bitcoin" : a;
const ourToken = (chainId: number, a: string) =>
  chainId === BITCOIN && a === "bitcoin" ? (NON_EVM[BITCOIN]?.native ?? a) : a;

const BASE = "https://li.quest/v1";

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
    feeCosts?: { amountUSD?: string; included?: boolean; percentage?: string }[];
  };
  includedSteps?: LifiStep[];
  transactionRequest?: {
    to?: string;
    data: string;
    value?: string;
    gasLimit?: string;
    chainId?: number;
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
  const integrator = env.LIFI_INTEGRATOR || "myswapchan";
  return {
    name: "lifi",
    enabled: () => true,
    supports: () => true,
    async quote(req: QuoteRequest, signal) {
      const q = new URLSearchParams({
        fromChain: String(lifiChain(req.fromChainId)),
        toChain: String(lifiChain(req.toChainId)),
        fromToken: lifiToken(req.fromChainId, req.fromToken),
        toToken: lifiToken(req.toChainId, req.toToken),
        fromAmount: req.amount,
        fromAddress: req.taker ?? placeholderFor(req.fromChainId),
        ...(req.recipient || vmOf(req.toChainId) !== vmOf(req.fromChainId)
          ? { toAddress: req.recipient ?? placeholderFor(req.toChainId) }
          : {}),
        slippage: String(req.slippageBps / 10_000),
        integrator,
      });
      // LI.FI rejects fee= (code 1011) until the "swapchan" integrator has a fee wallet in
      // portal.li.fi. Always ask for it; fall back to fee-less (ranked down, unverified) on rejection.
      let s: LifiStep;
      let charged = false;
      if (feeBps > 0 && env.SWAPCHAN_LIFI_FEE !== "0") {
        const qf = new URLSearchParams(q);
        qf.set("fee", String(feeBps / 10_000));
        try {
          s = await getJson<LifiStep>(f, `${BASE}/quote?${qf}`, { headers, signal });
          charged = true;
        } catch (e) {
          if (!/1011|not configured for collecting fees/.test(String(e))) throw e;
          s = await getJson<LifiStep>(f, `${BASE}/quote?${q}`, { headers, signal });
        }
      } else s = await getJson<LifiStep>(f, `${BASE}/quote?${q}`, { headers, signal });
      const ourStep = (s.includedSteps ?? []).find((st) => st.tool === "feeCollection");
      // feeCollection carries LI.FI's own 0.25% plus ours in one line; take only our share.
      const ourPct = feeBps / 10_000;
      const ourFeeUsd =
        charged && ourStep
          ? (ourStep.estimate.feeCosts ?? []).reduce((a, x) => {
              const pct = Number(x.percentage ?? 0);
              const usd = Number(x.amountUSD ?? 0);
              return a + (pct > 0 ? (usd * Math.min(ourPct, pct)) / pct : usd);
            }, 0)
          : 0;
      const gasUsd = sumUsd(s.estimate.gasCosts);
      const feeUsd = sumUsd(s.estimate.feeCosts);
      const toUsd = s.estimate.toAmountUSD ? Number(s.estimate.toAmountUSD) : null;
      const tr = s.transactionRequest;
      const vm = vmOf(req.fromChainId);
      const gasLimit = vm === "evm" ? hexToDec(tr?.gasLimit) : undefined;
      const nonEvmTx: NonEvmTx | undefined =
        vm === "evm" || !tr
          ? undefined
          : vm === "svm"
            ? { vm, kind: "svm-base64", data: tr.data }
            : vm === "bvm"
              ? { vm, kind: "bvm-psbt", data: tr }
              : { vm, kind: "tvm-json", data: tr };
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
          fromChainId: ourChain(st.action.fromChainId),
          toChainId: ourChain(st.action.toChainId),
          fromToken: ourToken(ourChain(st.action.fromChainId), st.action.fromToken.address),
          toToken: ourToken(ourChain(st.action.toChainId), st.action.toToken.address),
          fromAmount: st.action.fromAmount,
          toAmount: st.estimate.toAmount,
        })),
        approvalAddress: vm === "evm" ? (s.estimate.approvalAddress ?? null) : null,
        tx:
          vm === "evm" && req.taker && tr?.to
            ? {
                chainId: tr.chainId ?? req.fromChainId,
                to: tr.to,
                data: tr.data,
                value: hexToDec(tr.value) ?? "0",
                ...(gasLimit ? { gasLimit } : {}),
              }
            : null,
        expiresAt: Date.now() + 60_000,
        ourFeeUsd,
        ourFeeVerified: ourFeeUsd > 0,
        ...(req.taker && nonEvmTx ? { execution: "nonevm" as const, nonEvmTx } : {}),
        // LI.FI pays integrator fees to the wallets set for "myswapchan" in portal.li.fi.
        ...(ourFeeUsd > 0
          ? { feeRecipient: { address: `lifi-integrator:${integrator}`, chainId: req.fromChainId } }
          : {}),
      });
    },
    async status(req, signal) {
      const q = new URLSearchParams({
        txHash: req.txHash,
        fromChain: String(lifiChain(req.fromChainId)),
        toChain: String(lifiChain(req.toChainId)),
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
