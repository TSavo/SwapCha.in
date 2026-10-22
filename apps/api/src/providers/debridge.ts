import { isEvmChain, type NonEvmTx, Quote, SOLANA, StatusResponse } from "@swapchan/shared";
import { type Pricer, ZERO_ADDRESS } from "../pricing.js";
import { type Fetch, getJson, type ProviderAdapter } from "./types.js";

const BASE = "https://dln.debridge.finance/v1.0/dln";
const SOL_NATIVE = "11111111111111111111111111111111";
/** Our chain id -> deBridge chain id. */
const DLN: Record<number, number> = {
  1: 1,
  8453: 8453,
  42161: 42161,
  10: 10,
  137: 137,
  56: 56,
  43114: 43114,
  59144: 59144,
  [SOLANA]: 7565164,
};
const toDln = (chainId: number, a: string) =>
  chainId === SOLANA
    ? a
    : a.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      ? ZERO_ADDRESS
      : a;

interface Cost {
  chain: string;
  tokenIn: string;
  type: string;
  payload?: { feeAmount?: string };
}
interface CreateTx {
  estimation: {
    dstChainTokenOut: { amount: string; recommendedAmount?: string };
    costsDetails?: Cost[];
  };
  tx?: { to?: string; data: string; value?: string };
  fixFee?: string;
  orderId?: string;
  order?: { approximateFulfillmentDelay?: number };
  estimatedTransactionFee?: { total?: string };
  errorMessage?: string;
}

/**
 * deBridge DLN: cross-chain intents between EVM chains and Solana. Keyless. Our fee is the
 * affiliate fee (affiliateFeePercent, taken from the input); measured from costsDetails.
 */
export function debridge(
  pricer: Pricer,
  env: NodeJS.ProcessEnv,
  f: Fetch = fetch,
): ProviderAdapter {
  const feeBps = Number(env.SWAPCHAN_FEE_BPS ?? 0);
  const recipientFor = (chainId: number) =>
    chainId === SOLANA ? env.SWAPCHAN_FEE_RECIPIENT_SOLANA : env.SWAPCHAN_FEE_RECIPIENT;
  return {
    name: "debridge",
    enabled: () => true,
    supports: (r) => r.fromChainId !== r.toChainId && r.fromChainId in DLN && r.toChainId in DLN,
    async quote(req, signal) {
      const src = DLN[req.fromChainId] as number;
      const dst = DLN[req.toChainId] as number;
      const q = new URLSearchParams({
        srcChainId: String(src),
        srcChainTokenIn: toDln(req.fromChainId, req.fromToken),
        srcChainTokenInAmount: req.amount,
        dstChainId: String(dst),
        dstChainTokenOut: toDln(req.toChainId, req.toToken),
        dstChainTokenOutAmount: "auto",
        prependOperatingExpenses: "false",
        referralCode: env.DEBRIDGE_REFERRAL_CODE || "",
      });
      if (!q.get("referralCode")) q.delete("referralCode");
      const feeTo = recipientFor(req.fromChainId);
      if (feeTo && feeBps > 0) {
        q.set("affiliateFeePercent", String(feeBps / 100));
        q.set("affiliateFeeRecipient", feeTo);
      }
      const to =
        req.recipient ??
        (isEvmChain(req.toChainId) === isEvmChain(req.fromChainId) ? req.taker : undefined);
      if (req.taker && to) {
        q.set("srcChainOrderAuthorityAddress", req.taker);
        q.set("srcChainRefundAddress", req.taker);
        q.set("dstChainTokenOutRecipient", to);
        q.set("dstChainOrderAuthorityAddress", to);
      }
      const r = await getJson<CreateTx>(f, `${BASE}/order/create-tx?${q}`, { signal });
      if (!r.estimation) throw new Error(r.errorMessage ?? "no estimation");
      const outAmt =
        r.estimation.dstChainTokenOut.recommendedAmount ?? r.estimation.dstChainTokenOut.amount;
      const aff = r.estimation.costsDetails?.find((c) => c.type === "AffiliateFee");
      const affRaw = BigInt(aff?.payload?.feeAmount ?? "0");
      const [outUsd, feeUsd, fixUsd, txUsd] = await Promise.all([
        pricer.usd(req.toChainId, req.toToken, outAmt),
        affRaw > 0n && aff ? pricer.usd(req.fromChainId, aff.tokenIn, affRaw) : Promise.resolve(0),
        r.fixFee && req.fromChainId !== SOLANA
          ? pricer.usd(req.fromChainId, ZERO_ADDRESS, r.fixFee)
          : Promise.resolve(0),
        r.estimatedTransactionFee?.total && req.fromChainId !== SOLANA
          ? pricer.usd(req.fromChainId, ZERO_ADDRESS, r.estimatedTransactionFee.total)
          : Promise.resolve(0),
      ]);
      const gasUsd = (fixUsd ?? 0) + (txUsd ?? 0);
      const ourFeeUsd = feeUsd ?? 0;
      const evmSrc = isEvmChain(req.fromChainId);
      const native = toDln(req.fromChainId, req.fromToken) === (evmSrc ? ZERO_ADDRESS : SOL_NATIVE);
      let nonEvmTx: NonEvmTx | undefined;
      if (!evmSrc && r.tx?.data)
        nonEvmTx = {
          vm: "svm",
          kind: "svm-base64",
          data: Buffer.from(r.tx.data.replace(/^0x/, ""), "hex").toString("base64"),
        };
      return Quote.parse({
        id: `debridge:${r.orderId ?? crypto.randomUUID()}`,
        provider: "debridge",
        request: req,
        toAmount: outAmt,
        toAmountMin: outAmt, // DLN orders fill at the quoted amount or not at all
        gasUsd,
        feeUsd: ourFeeUsd,
        netUsd: outUsd === null ? null : outUsd - gasUsd,
        etaSeconds: Math.max(5, Math.round(r.order?.approximateFulfillmentDelay ?? 10)),
        steps: [
          {
            type: "bridge",
            tool: "debridge-dln",
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: outAmt,
          },
        ],
        approvalAddress: evmSrc && !native && r.tx?.to ? r.tx.to : null,
        tx:
          evmSrc && r.tx?.to
            ? {
                chainId: req.fromChainId,
                to: r.tx.to as `0x${string}`,
                data: r.tx.data as `0x${string}`,
                value: r.tx.value ?? "0",
              }
            : null,
        expiresAt: Date.now() + 30_000,
        ourFeeUsd,
        ourFeeVerified: affRaw > 0n,
        ...(nonEvmTx ? { execution: "nonevm" as const, nonEvmTx } : {}),
        ...(feeTo && affRaw > 0n
          ? { feeRecipient: { address: feeTo, chainId: req.fromChainId } }
          : {}),
      });
    },
    async status(req, signal) {
      const ids = await getJson<{ orderIds?: ({ stringValue?: string } | string)[] }>(
        f,
        `${BASE}/tx/${req.txHash}/order-ids`,
        { signal },
      );
      const first = ids.orderIds?.[0];
      const id = typeof first === "string" ? first : first?.stringValue;
      if (!id) return { status: "not_found", receivingTxHash: null };
      const s = await getJson<{ status?: string }>(f, `${BASE}/order/${id}/status`, { signal });
      const st = s.status ?? "";
      return StatusResponse.parse({
        status: /Fulfilled|SentUnlock|ClaimedUnlock/.test(st)
          ? "done"
          : /Cancel/.test(st)
            ? "failed"
            : "pending",
        receivingTxHash: null,
      });
    },
  };
}
