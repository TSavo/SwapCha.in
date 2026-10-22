import {
  BITCOIN,
  type BuildResponse,
  NON_EVM,
  type NonEvmTx,
  Quote,
  type QuoteRequest,
  StatusResponse,
  TRON,
  vmOf,
} from "@swapchan/shared";
import { encodeFunctionData } from "viem";
import { buildBtcPsbt, type UtxoSource } from "../btc.js";
import { type Pricer, ZERO_ADDRESS } from "../pricing.js";
import { type Fetch, getJson, type ProviderAdapter, placeholderFor } from "./types.js";

const DEFAULT_BASE = "https://gateway.liquify.com/chain/thorchain_api/thorchain";
/** Our chain id -> THORChain chain prefix. */
const PREFIX: Record<number, string> = {
  1: "ETH",
  8453: "BASE",
  56: "BSC",
  43114: "AVAX",
  [BITCOIN]: "BTC",
  [TRON]: "TRON",
};
const NATIVE: Record<string, string> = {
  ETH: "ETH.ETH",
  BASE: "BASE.ETH",
  BSC: "BSC.BNB",
  AVAX: "AVAX.AVAX",
  BTC: "BTC.BTC",
  TRON: "TRON.TRX",
};
const isNative = (chainId: number, a: string) =>
  NON_EVM[chainId]?.native === a ||
  a.toLowerCase() === ZERO_ADDRESS ||
  a.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const routerAbi = [
  {
    name: "depositWithExpiry",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "string" },
      { name: "expiration", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

interface ThorQuote {
  inbound_address: string;
  router?: string;
  memo: string;
  expected_amount_out: string;
  expiry: number;
  total_swap_seconds?: number;
  recommended_gas_rate?: string;
  fees: { asset: string; affiliate: string; outbound: string; liquidity: string; total: string };
  error?: string;
  message?: string;
}

const scale = (x: bigint, from: number, to: number) =>
  to >= from ? x * 10n ** BigInt(to - from) : x / 10n ** BigInt(from - to);

/**
 * THORChain native swaps (BTC, ETH, BASE, BSC, AVAX, TRON L1 assets). Keyless. Our fee is
 * the affiliate fee, which needs a registered THORName (THORCHAIN_AFFILIATE); without one,
 * routes run fee-free and rank with our fee as a handicap. Measured from fees.affiliate.
 */
export function thorchain(
  pricer: Pricer,
  env: NodeJS.ProcessEnv,
  f: Fetch = fetch,
  utxos?: UtxoSource,
): ProviderAdapter {
  const base = env.THORNODE_URL || DEFAULT_BASE;
  const affiliate = env.THORCHAIN_AFFILIATE;
  const feeBps = Number(env.SWAPCHAN_FEE_BPS ?? 0);
  let pools: { at: number; v: Promise<Set<string>> } | undefined;
  const poolSet = () => {
    if (!pools || Date.now() - pools.at > 600_000)
      pools = {
        at: Date.now(),
        v: getJson<{ asset: string; status: string }[]>(f, `${base}/pools`, {}).then(
          (ps) => new Set(ps.filter((p) => p.status === "Available").map((p) => p.asset)),
        ),
      };
    return pools.v;
  };
  const assetOf = async (chainId: number, token: string) => {
    const pre = PREFIX[chainId];
    if (!pre) return null;
    if (isNative(chainId, token)) return NATIVE[pre] ?? null;
    const set = await poolSet();
    const up = token.toUpperCase();
    for (const a of set)
      if (a.startsWith(`${pre}.`) && a.toUpperCase().endsWith(`-${up}`)) return a;
    return null;
  };
  const call = async (req: QuoteRequest, signal: AbortSignal) => {
    const [fromAsset, toAsset, src, dst] = await Promise.all([
      assetOf(req.fromChainId, req.fromToken),
      assetOf(req.toChainId, req.toToken),
      pricer.token(req.fromChainId, req.fromToken),
      pricer.token(req.toChainId, req.toToken),
    ]);
    if (!fromAsset || !toAsset) throw new Error("asset not in a THORChain pool");
    if (!src || !dst) throw new Error("unknown token decimals");
    const sameVm = vmOf(req.fromChainId) === vmOf(req.toChainId);
    const destination =
      req.recipient ?? (sameVm && req.taker ? req.taker : placeholderFor(req.toChainId));
    const q = new URLSearchParams({
      from_asset: fromAsset,
      to_asset: toAsset,
      amount: scale(BigInt(req.amount), src.decimals, 8).toString(),
      destination,
      streaming_interval: "1",
      streaming_quantity: "0",
      tolerance_bps: String(req.slippageBps),
    });
    if (req.taker) q.set("refund_address", req.taker);
    if (affiliate && feeBps > 0) {
      q.set("affiliate", affiliate);
      q.set("affiliate_bps", String(feeBps));
    }
    const r = await getJson<ThorQuote>(f, `${base}/quote/swap?${q}`, { signal });
    if (r.error || r.message) throw new Error(r.error ?? r.message);
    return { r, src, dst };
  };

  const toTx = async (
    req: QuoteRequest,
    r: ThorQuote,
  ): Promise<{ tx: Quote["tx"]; nonEvmTx?: NonEvmTx; approval: string | null }> => {
    const vm = vmOf(req.fromChainId);
    if (vm === "evm") {
      const native = isNative(req.fromChainId, req.fromToken);
      if (!r.router) throw new Error("THORChain returned no router");
      return {
        approval: native ? null : r.router,
        tx: req.taker
          ? {
              chainId: req.fromChainId,
              to: r.router as `0x${string}`,
              data: encodeFunctionData({
                abi: routerAbi,
                functionName: "depositWithExpiry",
                args: [
                  r.inbound_address as `0x${string}`,
                  (native ? ZERO_ADDRESS : req.fromToken) as `0x${string}`,
                  BigInt(req.amount),
                  r.memo,
                  BigInt(r.expiry),
                ],
              }),
              value: native ? req.amount : "0",
            }
          : null,
      };
    }
    if (vm === "tvm") {
      if (!isNative(req.fromChainId, req.fromToken))
        throw new Error("THORChain: only TRX from Tron");
      return {
        approval: null,
        tx: null,
        nonEvmTx: {
          vm,
          kind: "tvm-deposit",
          data: { to: r.inbound_address, amount: req.amount, memo: r.memo },
        },
      };
    }
    if (vm === "bvm") {
      if (!req.taker || !utxos) return { approval: null, tx: null };
      const psbt = await buildBtcPsbt(utxos, {
        from: req.taker,
        to: r.inbound_address,
        amount: BigInt(req.amount),
        memo: r.memo,
        feeRate: Number(r.recommended_gas_rate ?? 5),
      });
      return { approval: null, tx: null, nonEvmTx: { vm, kind: "bvm-psbt", data: psbt } };
    }
    throw new Error("unsupported origin VM");
  };

  return {
    name: "thorchain",
    enabled: () => true,
    supports: (r) =>
      r.fromChainId in PREFIX && r.toChainId in PREFIX && r.fromChainId !== r.toChainId,
    async quote(req, signal) {
      const { r, dst } = await call(req, signal);
      const out = scale(BigInt(r.expected_amount_out), 8, dst.decimals);
      const affRaw = scale(BigInt(r.fees.affiliate || "0"), 8, dst.decimals);
      const [outUsd, ourFeeUsd] = await Promise.all([
        pricer.usd(req.toChainId, req.toToken, out),
        affRaw > 0n ? pricer.usd(req.toChainId, req.toToken, affRaw) : Promise.resolve(0),
      ]);
      const x = req.taker ? await toTx(req, r).catch(() => null) : null;
      return Quote.parse({
        id: `thorchain:${crypto.randomUUID()}`,
        provider: "thorchain",
        request: req,
        toAmount: out.toString(),
        toAmountMin: ((out * BigInt(10_000 - req.slippageBps)) / 10_000n).toString(),
        gasUsd: 0,
        feeUsd: ourFeeUsd ?? 0,
        netUsd: outUsd,
        etaSeconds: Math.max(6, Math.round(r.total_swap_seconds ?? 60)),
        steps: [
          {
            type: req.fromChainId === req.toChainId ? "swap" : "bridge",
            tool: "thorchain",
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: out.toString(),
          },
        ],
        approvalAddress:
          vmOf(req.fromChainId) === "evm" && !isNative(req.fromChainId, req.fromToken)
            ? (r.router ?? null)
            : null,
        tx: x?.tx ?? null,
        expiresAt: Math.min(Date.now() + 60_000, r.expiry * 1000),
        ourFeeUsd: ourFeeUsd ?? 0,
        ourFeeVerified: affRaw > 0n,
        ...(x?.nonEvmTx ? { execution: "nonevm" as const, nonEvmTx: x.nonEvmTx } : {}),
      });
    },
    async build(req, signal): Promise<BuildResponse> {
      const { r } = await call(req, signal);
      const x = await toTx(req, r);
      if (x.tx) return { ...x.tx, execution: "tx" };
      if (!x.nonEvmTx) throw new Error("THORChain: no transaction for this origin");
      // Non-EVM: placeholder EVM fields are ignored by the client when execution === "nonevm".
      return {
        chainId: req.fromChainId,
        to: ZERO_ADDRESS,
        data: "0x",
        value: "0",
        execution: "nonevm",
        nonEvmTx: x.nonEvmTx,
      };
    },
    async status(req, signal) {
      const s = await getJson<{
        tx?: unknown;
        out_txs?: { id: string }[];
        stages?: { outbound_signed?: { completed?: boolean }; swap_status?: { pending?: boolean } };
      }>(f, `${base}/tx/status/${req.txHash.replace(/^0x/, "")}`, { signal }).catch(() => null);
      if (!s?.tx) return { status: "not_found", receivingTxHash: null };
      const out = s.out_txs?.[0]?.id;
      const done = !!out && s.stages?.outbound_signed?.completed !== false;
      return StatusResponse.parse({
        status: done ? "done" : "pending",
        receivingTxHash: out ?? null,
      });
    },
  };
}
