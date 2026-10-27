import {
  BITCOIN,
  BITCOIN_CASH,
  type BuildResponse,
  DOGECOIN,
  fromBaseUnits,
  LITECOIN,
  NON_EVM,
  type NonEvmTx,
  Quote,
  type QuoteRequest,
  StatusResponse,
  sameAddressSpace,
  TRON,
  type UtxoDeposit,
  UtxoTrack,
  vmOf,
} from "@swapchan/shared";
import { encodeFunctionData } from "../blocktools.js";

import { buildBtcPsbt, type UtxoSource } from "../btc.js";
import { type Pricer, ZERO_ADDRESS } from "../pricing.js";
import { RouteRefused, UTXO_DEST, validateUtxoRecipient } from "../utxodest.js";
import { buildUtxoSend, MEMO_LIMIT } from "../utxosend.js";
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
  // THORChain-only UTXO coins (both directions; Relay and LI.FI never see them, see aggregate.ts).
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
  /** smallest inbound THORChain observes on this chain (base units, 1e8); at or below it the coins are lost */
  dust_threshold?: string;
  recommended_min_amount_in?: string;
  fees: { asset: string; affiliate: string; outbound: string; liquidity: string; total: string };
  error?: string;
  message?: string;
}

const TOLERANCE_FLOOR_BPS = 300;

/** Block-explorer link for a THORChain outbound (thornode ids carry no 0x and may be upper case). */
export function explorerTx(chain: string, id: string): string | null {
  const h = id.toLowerCase().replace(/^0x/, "");
  const evm: Record<string, string> = {
    ETH: "https://etherscan.io/tx/0x",
    BASE: "https://basescan.org/tx/0x",
    BSC: "https://bscscan.com/tx/0x",
    AVAX: "https://snowtrace.io/tx/0x",
  };
  const other: Record<string, string> = {
    BTC: "https://mempool.space/tx/",
    LTC: "https://blockchair.com/litecoin/transaction/",
    DOGE: "https://blockchair.com/dogecoin/transaction/",
    BCH: "https://blockchair.com/bitcoin-cash/transaction/",
    TRON: "https://tronscan.org/#/transaction/",
  };
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  if (evm[chain]) return `${evm[chain]}${h}`;
  if (other[chain]) return `${other[chain]}${h}`;
  return null;
}
const normVault = (a: string) =>
  a
    .trim()
    .toLowerCase()
    .replace(/^bitcoincash:/, "");

const scale = (x: bigint, from: number, to: number) =>
  to >= from ? x * 10n ** BigInt(to - from) : x / 10n ** BigInt(from - to);

/**
 * THORChain native swaps (BTC, ETH, BASE, BSC, AVAX, TRON L1 assets). Keyless. Our fee is
 * the affiliate fee, which needs the THORName (THORCHAIN_AFFILIATE, default "swapchan", checked on
 * thornode every 10 min); until it exists,
 * routes run fee-free and rank with our fee as a handicap. Measured from fees.affiliate.
 */
export type ThorAdapter = ProviderAdapter & {
  /** Deposit-address flow for LTC/DOGE/BCH: vault, exact amount, memo (with the refund address), minimum, expiry. */
  deposit(req: QuoteRequest, refund: string, signal: AbortSignal): Promise<UtxoDeposit>;
  /** Read-only progress of an inbound txid on THORChain. */
  track(txid: string, signal: AbortSignal): Promise<UtxoTrack>;
};

export function thorchain(
  pricer: Pricer,
  env: NodeJS.ProcessEnv,
  f: Fetch = fetch,
  utxos?: UtxoSource,
): ThorAdapter {
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
  /** keepRefund: never drop the refund address on "memo too long" (the deposit flow refuses instead: a deposit from
   *  an exchange would otherwise be refunded to an address the user does not control). refund: overrides req.taker. */
  const call = async (
    req: QuoteRequest,
    signal: AbortSignal,
    opts: { keepRefund?: boolean; refund?: string } = {},
  ) => {
    const [fromAsset, toAsset, src, dst] = await Promise.all([
      assetOf(req.fromChainId, req.fromToken),
      assetOf(req.toChainId, req.toToken),
      pricer.token(req.fromChainId, req.fromToken),
      pricer.token(req.toChainId, req.toToken),
    ]);
    if (!fromAsset || !toAsset) throw new Error("asset not in a THORChain pool");
    if (!src || !dst) throw new Error("unknown token decimals");
    // LTC/DOGE/BCH share the "uvm" tag but not addresses: LTC -> DOGE is a cross-chain payout.
    const sameVm = sameAddressSpace(req.fromChainId, req.toChainId);
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
    let refund = opts.refund ?? req.taker;
    if (refund && UTXO_DEST[req.fromChainId]) {
      // LTC/DOGE/BCH origin: the refund address goes into the memo, so it is blocktools-validated for the sending
      // chain and canonical (BCH prefixless) like any payout address.
      const v = validateUtxoRecipient(req.fromChainId, refund);
      if (!v.ok) throw new RouteRefused(`refund address: ${v.reason}`);
      refund = v.address;
    }
    if (refund) q.set("refund_address", refund);
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
      !opts.keepRefund &&
      (vmOf(req.fromChainId) === "bvm" || vmOf(req.fromChainId) === "uvm")
    ) {
      // Bitcoin memos ride in an 80-byte OP_RETURN. "=:e:<42-char 0x addr>:LIM/1/0" is already ~52 bytes, so
      // "/<refund>" overflows for every BTC address type. THORChain refunds to the sending address when the memo
      // names none, and our PSBT spends only the taker's UTXOs, so a refund still goes to req.taker.
      // The affiliate is never dropped: if it is what overflows, the retry fails and we refuse below.
      // LTC/DOGE (80 bytes) behave like BTC; BCH allows 220. Only the in-app PSBT path may drop it: that PSBT
      // spends only the taker's coins, so THORChain's default refund (the sending address) is the taker.
      q.delete("refund_address");
      r = await ask();
      refundDropped = true;
    }
    if (r.error || r.message) {
      const e = r.error ?? r.message ?? "";
      if (MEMO_TOO_LONG.test(e)) {
        const sym = PREFIX[req.fromChainId] ?? "this chain";
        const lim = sym === "BTC" ? 80 : (MEMO_LIMIT[sym.toLowerCase()] ?? 80);
        throw new RouteRefused(
          opts.keepRefund
            ? `THORChain: the swap memo with your refund address does not fit ${sym}'s ${lim}-byte OP_RETURN; use a shorter refund address (for example a legacy or P2SH one) or the in-app transaction`
            : `THORChain: memo does not fit ${sym}'s ${lim}-byte OP_RETURN for this destination; refusing rather than dropping SwapChan's fee`,
        );
      }
      throw new Error(e);
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
    if (vm === "uvm") {
      if (!isNative(req.fromChainId, req.fromToken))
        throw new RouteRefused("THORChain: only the native coin can be sent from this chain");
      if (!req.taker) return { approval: null, tx: null };
      const amount = BigInt(req.amount);
      if (r.dust_threshold && amount <= BigInt(r.dust_threshold))
        throw new RouteRefused(
          `amount is at or below THORChain's minimum for this chain (${fromBaseUnits(BigInt(r.dust_threshold), 8)}); it would be lost`,
        );
      const out = await buildUtxoSend(f, env, {
        chainId: req.fromChainId,
        taker: req.taker,
        vault: r.inbound_address,
        amount,
        memo: r.memo,
        feeRate: Number(r.recommended_gas_rate ?? 0) || 1,
      });
      return {
        approval: null,
        tx: null,
        nonEvmTx: { vm, kind: "uvm-psbt", data: { psbt: out.psbt, summary: out.summary } },
      };
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
      // LTC/DOGE/BCH PSBTs are built at /build only (each one fetches the taker's coins and previous txs).
      const x =
        req.taker && vmOf(req.fromChainId) !== "uvm" ? await toTx(req, r).catch(() => null) : null;
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
    async deposit(req, refund, signal): Promise<UtxoDeposit> {
      const d = UTXO_DEST[req.fromChainId];
      if (!d)
        throw new RouteRefused(
          "deposit addresses are offered for Litecoin, Dogecoin and Bitcoin Cash only",
        );
      if (!isNative(req.fromChainId, req.fromToken))
        throw new RouteRefused(`${d.name}: only the native coin can be sent`);
      if (!refund?.trim())
        throw new RouteRefused(`refund address required: a ${d.name} address you control`);
      const rv = validateUtxoRecipient(req.fromChainId, refund);
      if (!rv.ok) throw new RouteRefused(`refund address: ${rv.reason}`);
      const { taker: _t, ...noTaker } = req;
      const [{ r, dst }, ibs] = await Promise.all([
        call(noTaker as QuoteRequest, signal, { keepRefund: true, refund: rv.address }),
        getJson<
          {
            chain: string;
            address: string;
            halted?: boolean;
            chain_trading_paused?: boolean;
            dust_threshold?: string;
          }[]
        >(f, `${base}/inbound_addresses`, { signal }),
      ]);
      const memo = r.memo ?? "";
      const limit = MEMO_LIMIT[d.bt]!;
      const memoBytes = Buffer.byteLength(memo, "utf8");
      if (memoBytes > limit)
        throw new RouteRefused(
          `THORChain's memo is ${memoBytes} bytes, over ${d.sym}'s ${limit}-byte OP_RETURN limit; not offered`,
        );
      // THORChain's own memo must carry this refund address (dest field "<payout>/<refund>").
      const refundInMemo = (memo.split(":")[2] ?? "").split("/")[1] ?? "";
      if (refundInMemo.toLowerCase() !== rv.address.toLowerCase())
        throw new Error("THORChain: the memo does not carry the refund address; not offered");
      const ib = ibs.find((x) => x.chain === d.sym);
      if (!ib || ib.halted || ib.chain_trading_paused)
        throw new RouteRefused(`THORChain has paused ${d.name} right now; try again later`);
      if (normVault(ib.address) !== normVault(r.inbound_address))
        throw new Error("THORChain's vault changed between two reads; try again");
      const dustRaw = ib.dust_threshold ?? r.dust_threshold;
      if (!dustRaw || !/^\d+$/.test(dustRaw))
        throw new Error(`THORChain did not report its ${d.sym} minimum; not offered`);
      const dust = BigInt(dustRaw);
      const amount = BigInt(req.amount);
      if (amount <= dust)
        throw new RouteRefused(
          `amount must be above THORChain's ${d.sym} minimum of ${fromBaseUnits(dust, 8)} ${d.sym}; smaller sends are lost`,
        );
      const out = scale(BigInt(r.expected_amount_out), 8, dst.decimals);
      return {
        chain: d.sym,
        vault: r.inbound_address,
        amount: amount.toString(),
        amountDisplay: fromBaseUnits(amount, 8),
        memo,
        memoBytes,
        memoLimit: limit,
        minimum: dust.toString(),
        minimumDisplay: fromBaseUnits(dust, 8),
        expiresAt: r.expiry,
        refund: rv.address,
        expectedOut: fromBaseUnits(out, dst.decimals),
        warnings: [
          `The memo is required. A ${d.sym} send without this exact memo in an OP_RETURN output cannot be matched to your swap.`,
          "Do not send from an exchange: exchanges cannot add the memo, and a refund would go to the address in the memo, not to the exchange.",
          `Send exactly ${fromBaseUnits(amount, 8)} ${d.sym} in one transaction before the quote expires.`,
        ],
      };
    },
    async track(txid, signal): Promise<UtxoTrack> {
      const id = txid.replace(/^0x/, "").toUpperCase();
      const thorchainUrl = `https://thorchain.net/tx/${id}`;
      type Out = { chain: string; id: string; memo?: string };
      const s = await getJson<{
        tx?: unknown;
        out_txs?: Out[];
        planned_out_txs?: { chain: string; refund?: boolean }[];
        stages?: {
          inbound_observed?: { started?: boolean; completed?: boolean };
          inbound_confirmation_counted?: { completed?: boolean };
          swap_status?: { pending?: boolean };
          swap_finalised?: { completed?: boolean };
          outbound_signed?: { completed?: boolean };
        };
        error?: string;
      }>(f, `${base}/tx/status/${id}`, { signal }).catch((e: unknown) => {
        if (e instanceof Error && /^(404|400)\b/.test(e.message)) return null;
        throw e;
      });
      const waiting: UtxoTrack = {
        state: "waiting",
        message:
          "THORChain has not seen this transaction yet. It shows up once your wallet broadcasts it.",
        thorchainUrl,
        payout: null,
      };
      if (!s || !s.tx || s.stages?.inbound_observed?.started === false) return waiting;
      const outs = (s.out_txs ?? []).filter((o) => o.id && !/^0+$/.test(o.id));
      const refundPlanned = (s.planned_out_txs ?? []).some((p) => p.refund);
      const out = outs[0];
      if (out && s.stages?.outbound_signed?.completed !== false) {
        const refunded = refundPlanned || /^refund/i.test(out.memo ?? "");
        return UtxoTrack.parse({
          state: refunded ? "refunded" : "paid_out",
          message: refunded
            ? "THORChain refunded this swap to the refund address (minus network fees)."
            : "Paid out: THORChain sent the swap output.",
          thorchainUrl,
          payout: { chain: out.chain, txid: out.id, url: explorerTx(out.chain, out.id) },
        });
      }
      if (s.error)
        return {
          state: "failed",
          message: `THORChain reports: ${s.error.slice(0, 160)}`,
          thorchainUrl,
          payout: null,
        };
      if (
        s.stages?.inbound_observed?.completed === false ||
        s.stages?.inbound_confirmation_counted?.completed === false
      )
        return {
          state: "seen",
          message: "THORChain has seen your transaction and is waiting for confirmations.",
          thorchainUrl,
          payout: null,
        };
      return {
        state: "swapping",
        message: refundPlanned
          ? "The swap could not complete; THORChain is sending a refund."
          : "Swapping: THORChain is executing the swap and preparing the payout.",
        thorchainUrl,
        payout: null,
      };
    },
  };
}
