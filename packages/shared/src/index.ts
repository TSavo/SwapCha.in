import { formatUnits, isAddress, parseUnits } from "viem";
import { z } from "zod";
import tokenListJson from "./tokenList.json" with { type: "json" };

/** Contract version. Bump on any breaking change to the schemas below. */
export const API_VERSION = "1" as const;

export const ChainId = z.number().int().positive();
export type ChainId = z.infer<typeof ChainId>;

export const SUPPORTED_CHAINS = {
  1: { name: "Ethereum", mascot: "eth-chan" },
  8453: { name: "Base", mascot: "base-chan" },
  42161: { name: "Arbitrum", mascot: "arb-chan" },
  10: { name: "Optimism", mascot: "op-chan" },
  137: { name: "Polygon", mascot: "poly-chan" },
  56: { name: "BNB Chain", mascot: "bnb-chan" },
  43114: { name: "Avalanche", mascot: "avax-chan" },
  59144: { name: "Linea", mascot: "linea-chan" },
  534352: { name: "Scroll", mascot: "scroll-chan" },
  792703809: { name: "Solana", mascot: "sol-chan" },
  8253038: { name: "Bitcoin", mascot: "btc-chan" },
  728126428: { name: "Tron", mascot: "tron-chan" },
} as const satisfies Record<number, { name: string; mascot: string }>;

/** Virtual machine family per chain. Non-EVM chain ids follow Relay's numbering. */
export type Vm = "evm" | "svm" | "bvm" | "tvm";
export const SOLANA = 792703809;
export const BITCOIN = 8253038;
export const TRON = 728126428;
export const NON_EVM: Record<number, { vm: Vm; native: string }> = {
  [SOLANA]: { vm: "svm", native: "11111111111111111111111111111111" },
  [BITCOIN]: { vm: "bvm", native: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8" },
  [TRON]: { vm: "tvm", native: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb" },
};
export const vmOf = (chainId: number): Vm => NON_EVM[chainId]?.vm ?? "evm";
export const isEvmChain = (chainId: number) => vmOf(chainId) === "evm";

const B58 = "[1-9A-HJ-NP-Za-km-z]";
const PATTERNS: Record<Exclude<Vm, "evm">, RegExp> = {
  svm: new RegExp(`^${B58}{32,44}$`),
  bvm: /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  tvm: new RegExp(`^T${B58}{33}$`),
};
/** True if `a` is a well-formed address (wallet or token) on a chain of VM `vm`. */
export const isVmAddress = (a: string, vm: Vm): boolean =>
  vm === "evm" ? isAddress(a, { strict: false }) : PATTERNS[vm].test(a);
export const isAnyAddress = (a: string) =>
  (["evm", "svm", "bvm", "tvm"] as const).some((vm) => isVmAddress(a, vm));
/** Native token sentinel for any supported chain. */
export const nativeOf = (chainId: number): string => NON_EVM[chainId]?.native ?? NATIVE_TOKEN;

export const Chain = z.object({ id: ChainId, name: z.string(), mascot: z.string() });
export type Chain = z.infer<typeof Chain>;

export const Address = z
  .string()
  .refine((a) => isAnyAddress(a), "invalid address")
  .transform((a) => a as `0x${string}`);
/** Strict EVM address (tx targets, spenders). */
export const EvmAddress = z
  .string()
  .refine((a) => isAddress(a, { strict: false }), "invalid EVM address")
  .transform((a) => a as `0x${string}`);
export const Hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/)
  .transform((h) => h as `0x${string}`);
/** Integer amount in base units, serialized as decimal string (never floats). */
export const BaseUnits = z.string().regex(/^\d+$/, "base-unit integer string");

/** Native gas token sentinel used across providers. */
export const NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export const Token = z.object({
  chainId: ChainId,
  address: Address,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().min(0).max(36),
  logoURI: z.string().url().optional(),
});
export type Token = z.infer<typeof Token>;

export const tokenList: Token[] = z.array(Token).parse(tokenListJson);

export const QuoteRequest = z.object({
  fromChainId: z.coerce.number().pipe(ChainId),
  toChainId: z.coerce.number().pipe(ChainId),
  fromToken: Address,
  toToken: Address,
  amount: BaseUnits,
  /** Optional: required by some providers to return a tx. */
  taker: Address.optional(),
  /** Receiving address on the destination chain; required when it's a different VM than taker's. */
  recipient: Address.optional(),
  /** Slippage in basis points (50 = 0.5%). */
  slippageBps: z.coerce.number().int().min(1).max(5000).default(50),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

export const RouteStep = z.object({
  type: z.enum(["swap", "bridge", "wrap", "approve", "fee"]),
  tool: z.string(),
  fromChainId: ChainId,
  toChainId: ChainId,
  fromToken: Address,
  toToken: Address,
  fromAmount: BaseUnits,
  toAmount: BaseUnits,
});
export type RouteStep = z.infer<typeof RouteStep>;

export const Simulation = z.object({
  ok: z.boolean(),
  method: z.enum(["eth_call", "tenderly"]),
  gasUsed: BaseUnits.optional(),
  error: z.string().optional(),
});
export type Simulation = z.infer<typeof Simulation>;

export const TxRequest = z.object({
  chainId: ChainId,
  to: EvmAddress,
  data: Hex,
  value: BaseUnits,
  gasLimit: BaseUnits.optional(),
  /** Present when the API simulated the tx (SWAPCHAN_SIMULATE). Additive in v1. */
  simulation: Simulation.optional(),
});

/** Generic EIP-712 payload (Permit2 PermitSingle/PermitTransferFrom, CoW orders). */
export const TypedData = z.object({
  domain: z.record(z.string(), z.unknown()),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});
export type TypedData = z.infer<typeof TypedData>;
export type TxRequest = z.infer<typeof TxRequest>;

/** Non-EVM transaction payload. svm-base64 = serialized VersionedTransaction (sign + send);
 * svm-instructions = Relay instruction list to compile with the lookup tables.
 * bvm-psbt = base64 or hex PSBT to sign + broadcast; tvm-json = provider-built Tron tx (or call);
 * tvm-deposit = {to, amount (sun), memo}: send TRX with the memo as tx data (THORChain). */
export const NonEvmTx = z.object({
  vm: z.enum(["svm", "bvm", "tvm"]),
  kind: z.enum(["svm-base64", "svm-instructions", "bvm-psbt", "tvm-json", "tvm-deposit"]),
  data: z.unknown(),
});
export type NonEvmTx = z.infer<typeof NonEvmTx>;

/** Server-side payload verification (router allowlist, calldata decode, approvals). */
export const Verification = z.object({
  verified: z.boolean(),
  level: z.enum(["full", "partial", "indicative"]),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })),
});
export type Verification = z.infer<typeof Verification>;

export const Quote = z.object({
  id: z.string(),
  provider: z.string(),
  request: QuoteRequest,
  toAmount: BaseUnits,
  toAmountMin: BaseUnits,
  gasUsd: z.number().nonnegative(),
  feeUsd: z.number().nonnegative(),
  /** toAmount value in USD minus gas and fees. Ranking key. */
  netUsd: z.number().nullable(),
  etaSeconds: z.number().int().nonnegative(),
  steps: z.array(RouteStep),
  /** Spender to approve for ERC20 input; null for native. */
  approvalAddress: EvmAddress.nullable(),
  tx: TxRequest.nullable(),
  expiresAt: z.number().int(),
  /** SwapChan's own fee on this route, in USD. 0 = this route pays us nothing. */
  ourFeeUsd: z.number().nonnegative().optional(),
  /** True when the provider confirmed our fee in its quote/tx (not just requested). */
  ourFeeVerified: z.boolean().optional(),
  /** Additive v1: "tx" = send `tx`; "order" = sign `order` typed data (CoW), no tx. Default "tx". */
  execution: z.enum(["tx", "order", "nonevm"]).optional(),
  /** EIP-712 order to sign when execution === "order". */
  order: TypedData.optional(),
  /** Additive v1: set when the origin chain is non-EVM (execution === "nonevm"). */
  nonEvmTx: NonEvmTx.optional(),
  /** Relay Protocol v2 order (orderId + orderData) the deposit commits to; verify with @relay-protocol/settlement-sdk. */
  relayOrder: z.object({ orderId: z.string(), orderData: z.any() }).optional(),
  /** Who receives SwapChan's fee on this route (address + chain), when known. */
  feeRecipient: z.object({ address: z.string(), chainId: ChainId }).optional(),
  /** Additive v1: true only when every guard check passed on this payload (needs taker). */
  verified: z.boolean().optional(),
  verification: Verification.optional(),
});
export type Quote = z.infer<typeof Quote>;

export const QuotesResponse = z.object({
  quotes: z.array(Quote),
  best: z.string().nullable(),
  errors: z.array(z.object({ provider: z.string(), message: z.string() })),
});
export type QuotesResponse = z.infer<typeof QuotesResponse>;

/** POST /build response: unsigned tx plus optional extras. Superset of TxRequest (additive). */
export const BuildResponse = TxRequest.extend({
  /** If set: sign this Permit2 typed data and pass the signature per provider docs instead of an approve tx. */
  permit2: TypedData.optional(),
  /** If set: send this approve tx first (ERC20 allowance missing/unknown). */
  approval: TxRequest.optional(),
  execution: z.enum(["tx", "order", "nonevm"]).optional(),
  order: TypedData.optional(),
  nonEvmTx: NonEvmTx.optional(),
  /** Relay Protocol v2 order (orderId + orderData) the deposit commits to; verify with @relay-protocol/settlement-sdk. */
  relayOrder: z.object({ orderId: z.string(), orderData: z.any() }).optional(),
  verified: z.boolean().optional(),
  verification: Verification.optional(),
  /** Set when the requested quote failed verification and a fallback route was built instead. */
  fallbackFrom: z
    .object({ quoteId: z.string(), provider: z.string(), reason: z.string() })
    .optional(),
  quoteId: z.string().optional(),
  provider: z.string().optional(),
});
export type BuildResponse = z.infer<typeof BuildResponse>;

export const StatusRequest = z.object({
  provider: z.string(),
  /** EVM tx hash, Solana signature, Bitcoin txid or Tron txid. */
  txHash: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$|^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
  fromChainId: z.coerce.number().pipe(ChainId),
  toChainId: z.coerce.number().pipe(ChainId),
});
export type StatusRequest = z.infer<typeof StatusRequest>;

export const StatusResponse = z.object({
  status: z.enum(["pending", "done", "failed", "not_found"]),
  receivingTxHash: z.string().nullable(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

/** Decimal string -> base units. Exact; no float math. */
export const toBaseUnits = (amount: string, decimals: number): bigint =>
  parseUnits(amount, decimals);
export const fromBaseUnits = (amount: bigint | string, decimals: number): string =>
  formatUnits(BigInt(amount), decimals);

export * from "./cow.js";
export * from "./playbook.js";
