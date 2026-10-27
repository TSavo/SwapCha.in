import {
  BITCOIN,
  BITCOIN_CASH,
  type BuildResponse,
  DOGECOIN,
  isReceiveOnly,
  LITECOIN,
  NON_EVM,
  type NonEvmTx,
  Quote,
  type QuoteRequest,
  StatusResponse,
  TRON,
  vmOf,
} from "@swapchan/shared";
import { encodeFunctionData } from "../blocktools.js";

import { buildBtcPsbt, type UtxoSource } from "../btc.js";
import { type Pricer, ZERO_ADDRESS } from "../pricing.js";
import { UTXO_DEST, validateUtxoRecipient } from "../utxodest.js";
import { type Fetch, getJson, type ProviderAdapter, placeholderFor } from "./types.js";

/** THORChain's error when memo + refund + affiliate exceed the source chain's memo limit (BTC: 80 bytes). */
const MEMO_TOO_LONG = /memo too long/i;
const DEFAULT_BASE = "https://gateway.liquify.com/chain/thorchain_api/thorchain";
/** Our chain id -> THORChain chain prefix. */
const PREFIX: Record<number, string> = {
  1: "ETH",
  8453: "BASE",
  56: "BSC",
  43114: "AVAX",
  [BITCOIN]: "BTC",
  [TRON]: "TRON",
  // Receive-only (destination) UTXO coins; refused as origin in `supports`.
  [LITECOIN]: "LTC",
  [DOGECOIN]: "DOGE",
  [BITCOIN_CASH]: "BCH",
};
const NATIVE: Record<string, string> = {
  ETH: "ETH.ETH",
  BASE: "BASE.ETH",
  BSC: "BSC.BNB",
  AVAX: "AVAX.AVAX",
  BTC: "BTC.BTC",
  TRON: "TRON.TRX",
  LTC: "LTC.LTC",
  DOGE: "DOGE.DOGE",
  BCH: "BCH.BCH",
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

const TOLERANCE_FLOOR_BPS = 300;

const scale = (x: bigint, from: number, to: number) =>
  to >= from ? x * 10n ** BigInt(to - from) : x / 10n ** BigInt(from - to);

/**
 * THORChain native swaps (BTC, ETH, BASE, BSC, AVAX, TRON L1 assets). Keyless. Our fee is
 * the affiliate fee, which needs the THORName (THORCHAIN_AFFILIATE, default "swapchan", checked on
 * thornode every 10 min); until it exists,
 * routes run fee-free and rank with our fee as a handicap. Measured from fees.affiliate.
 */
export function thorchain(
  pricer: Pricer,
  env: NodeJS.ProcessEnv,
  f: Fetch = fetch,
  utxos?: UtxoSource,
): ProviderAdapter {
  const base = env.THORNODE_URL || DEFAULT_BASE;
  const affiliate = env.THORCHAIN_AFFILIATE || "swapchan";
  // Only send the affiliate once the THORName exists (THORChain rejects unknown names).
  let named: { at: number; v: Promise<boolean> } | undefined;
  const nameLive = () => {
    if (!named || Date.now() - named.at > 600_000)
      named = {
        at: Date.now(),
        v: getJson<{ aliases?: { chain: string }[] }>(f, `${base}/thorname/${affiliate}`, {})
          .then((t) => !!t?.aliases?.some((a) => a.chain === "THOR"))
          .catch(() => false),
      };
    return named.v;
  };
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
    let destination =
      req.recipient ?? (sameVm && req.taker ? req.taker : placeholderFor(req.toChainId));
    if (UTXO_DEST[req.toChainId]) {
      // Receive-only UTXO payout: native coin only, recipient blocktools-validated and canonical (BCH prefixless:
      // memos are colon-separated). Re-checked here so no caller path can put an unvalidated address in a memo.
      if (!isNative(req.toChainId, req.toToken)) throw new Error("THORChain: only the native coin");
      if (req.recipient !== undefined) {
        const v = validateUtxoRecipient(req.toChainId, req.recipient);
        if (!v.ok) throw new Error(`recipient: ${v.reason}`);
        destination = v.address;
      }
    }
    const q = new URLSearchParams({
      from_asset: fromAsset,
      to_asset: toAsset,
      amount: scale(BigInt(req.amount), src.decimals, 8).toString(),
      destination,
      streaming_interval: "1",
      streaming_quantity: "0",
      // THORChain counts its own liquidity + outbound fees against tolerance; 0.5% rejects most swaps.
      tolerance_bps: String(Math.max(req.slippageBps, TOLERANCE_FLOOR_BPS)),
    });
    if (req.taker) q.set("refund_address", req.taker);
    if (affiliate && feeBps > 0 && (await nameLive())) {
      q.set("affiliate", affiliate);
      q.set("affiliate_bps", String(feeBps));
    }
    // THORChain answers an over-long memo with HTTP 400, which getJson throws; read it as an error body.
    const ask = () =>
      getJson<ThorQuote>(f, `${base}/quote/swap?${q}`, { signal }).catch(
        (e: unknown): ThorQuote => {
          if (e instanceof Error && MEMO_TOO_LONG.test(e.message))
            return { error: e.message } as ThorQuote;
          throw e;
        },
      );
    let r = await ask();
    let refundDropped = false;
    const err = r.error ?? r.message;
    if (
      err &&
      MEMO_TOO_LONG.test(err) &&
      q.has("refund_address") &&
      vmOf(req.fromChainId) === "bvm"
    ) {
      // Bitcoin memos ride in an 80-byte OP_RETURN. "=:e:<42-char 0x addr>:LIM/1/0" is already ~52 bytes, so
      // "/<refund>" overflows for every BTC address type. THORChain refunds to the sending address when the memo
      // names none, and our PSBT spends only the taker's UTXOs, so a refund still goes to req.taker.
      // The affiliate is never dropped: if it is what overflows, the retry fails and we refuse below.
      q.delete("refund_address");
      r = await ask();
      refundDropped = true;
    }
    if (r.error || r.message) {
      const e = r.error ?? r.message ?? "";
      throw new Error(
        MEMO_TOO_LONG.test(e)
          ? "THORChain: memo does not fit Bitcoin's 80-byte OP_RETURN for this destination; refusing rather than dropping SwapChan's fee"
          : e,
      );
    }
    if (refundDropped) {
      // Trust THORChain's own memo: its destination field must name no refund address.
      const destField = (r.memo ?? "").split(":")[2] ?? "";
      if (destField.includes("/"))
        throw new Error("THORChain: unexpected refund address in shortened memo");
    }
    return { r, src, dst, refundDropped };
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
      r.fromChainId in PREFIX &&
      !isReceiveOnly(r.fromChainId) &&
      r.toChainId in PREFIX &&
      r.fromChainId !== r.toChainId,
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
        toAmountMin: (
          (out * BigInt(10_000 - Math.max(req.slippageBps, TOLERANCE_FLOOR_BPS))) /
          10_000n
        ).toString(),
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
