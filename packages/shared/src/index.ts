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
} as const satisfies Record<number, { name: string; mascot: string }>;

export const Chain = z.object({ id: ChainId, name: z.string(), mascot: z.string() });
export type Chain = z.infer<typeof Chain>;

export const Address = z
  .string()
  .refine((a) => isAddress(a, { strict: false }), "invalid address")
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
  /** Slippage in basis points (50 = 0.5%). */
  slippageBps: z.coerce.number().int().min(1).max(5000).default(50),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

export const RouteStep = z.object({
  type: z.enum(["swap", "bridge", "wrap", "approve"]),
  tool: z.string(),
  fromChainId: ChainId,
  toChainId: ChainId,
  fromToken: Address,
  toToken: Address,
  fromAmount: BaseUnits,
  toAmount: BaseUnits,
});
export type RouteStep = z.infer<typeof RouteStep>;

export const TxRequest = z.object({
  chainId: ChainId,
  to: Address,
  data: Hex,
  value: BaseUnits,
  gasLimit: BaseUnits.optional(),
});
export type TxRequest = z.infer<typeof TxRequest>;

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
  approvalAddress: Address.nullable(),
  tx: TxRequest.nullable(),
  expiresAt: z.number().int(),
});
export type Quote = z.infer<typeof Quote>;

export const QuotesResponse = z.object({
  quotes: z.array(Quote),
  best: z.string().nullable(),
  errors: z.array(z.object({ provider: z.string(), message: z.string() })),
});
export type QuotesResponse = z.infer<typeof QuotesResponse>;

export const StatusRequest = z.object({
  provider: z.string(),
  txHash: Hex,
  fromChainId: z.coerce.number().pipe(ChainId),
  toChainId: z.coerce.number().pipe(ChainId),
});
export type StatusRequest = z.infer<typeof StatusRequest>;

export const StatusResponse = z.object({
  status: z.enum(["pending", "done", "failed", "not_found"]),
  receivingTxHash: Hex.nullable(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

/** Decimal string -> base units. Exact; no float math. */
export const toBaseUnits = (amount: string, decimals: number): bigint =>
  parseUnits(amount, decimals);
export const fromBaseUnits = (amount: bigint | string, decimals: number): string =>
  formatUnits(BigInt(amount), decimals);
