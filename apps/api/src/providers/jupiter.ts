import { NON_EVM, Quote, type QuoteRequest, SOLANA, StatusResponse } from "@swapchan/shared";
import type { Pricer } from "../pricing.js";
import { type Fetch, getJson, type ProviderAdapter, placeholderFor } from "./types.js";

const BASE = "https://api.jup.ag/swap/v2";
export const WSOL = "So11111111111111111111111111111111111111112";
const SOL_NATIVE = NON_EVM[SOLANA]?.native ?? "11111111111111111111111111111111";
export const toMint = (a: string) => (a === SOL_NATIVE ? WSOL : a);
const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];
/** Compute-unit limit we set (Jupiter's /build only returns the CU price). */
export const CU_LIMIT = 1_000_000;

interface JupIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}
interface JupBuild {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  routePlan: { swapInfo: { label: string } }[];
  computeBudgetInstructions: JupIx[];
  setupInstructions: JupIx[];
  swapInstruction: JupIx;
  cleanupInstruction: JupIx | null;
  otherInstructions: JupIx[];
  tipInstruction: JupIx | null;
  addressesByLookupTableAddress: Record<string, string[]> | null;
  error?: string;
}

const hex = (b64: string) => Buffer.from(b64, "base64").toString("hex");
/** Relay-shaped instruction (keys + hex data) so the web's existing svm-instructions path compiles it. */
const toRelayIx = (ix: JupIx) => ({
  programId: ix.programId,
  keys: ix.accounts.map((a) => ({
    pubkey: a.pubkey,
    isSigner: a.isSigner,
    isWritable: a.isWritable,
  })),
  data: hex(ix.data),
});
const cuLimitIx = (units: number) => {
  const d = Buffer.alloc(5);
  d.writeUInt8(2, 0);
  d.writeUInt32LE(units, 1);
  return {
    programId: "ComputeBudget111111111111111111111111111111",
    keys: [],
    data: d.toString("hex"),
  };
};
/** micro-lamports per CU from a SetComputeUnitPrice instruction (opcode 3, u64 LE). */
const cuPrice = (ixs: JupIx[]): bigint => {
  for (const ix of ixs) {
    const b = Buffer.from(ix.data, "base64");
    if (b[0] === 3 && b.length >= 9) return b.readBigUInt64LE(1);
  }
  return 0n;
};

/** Fee wallet's token accounts (mint -> account), from Solana RPC, cached. */
export function feeAccounts(owner: string, rpc: string, f: Fetch = fetch, ttlMs = 300_000) {
  let at = 0;
  let v: Promise<Map<string, string>> | null = null;
  const load = async () => {
    const m = new Map<string, string>();
    for (const programId of TOKEN_PROGRAMS) {
      const r = await getJson<{
        result?: {
          value: { pubkey: string; account: { data: { parsed: { info: { mint: string } } } } }[];
        };
      }>(f, rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [owner, { programId }, { encoding: "jsonParsed" }],
        }),
      });
      for (const a of r.result?.value ?? []) m.set(a.account.data.parsed.info.mint, a.pubkey);
    }
    return m;
  };
  return (): Promise<Map<string, string>> => {
    if (!v || Date.now() - at > ttlMs) {
      at = Date.now();
      v = load().catch(() => {
        at = 0;
        return new Map();
      });
    }
    return v;
  };
}

/** Jupiter Swap API v2 /build (Metis router, no Jupiter fee): Solana same-chain swaps. Our fee is
 * platformFeeBps into the fee wallet's token account for the output mint; when the
 * wallet has no account for that mint yet, the route goes out fee-less (ourFeeVerified=false). */
export function jupiter(
  pricer: Pricer,
  env: NodeJS.ProcessEnv,
  f: Fetch = fetch,
  accounts = feeAccounts(
    env.SWAPCHAN_FEE_RECIPIENT_SOLANA ?? "",
    env.SOLANA_RPC_URL ?? env.RPC_URL_792703809 ?? "https://api.mainnet-beta.solana.com",
    f,
  ),
): ProviderAdapter {
  const headers: Record<string, string> = env.JUPITER_API_KEY
    ? { "x-api-key": env.JUPITER_API_KEY }
    : {};
  const bps = Number(env.SWAPCHAN_FEE_BPS ?? 0);
  const owner = env.SWAPCHAN_FEE_RECIPIENT_SOLANA;
  return {
    name: "jupiter",
    enabled: () => true,
    supports: (r) => r.fromChainId === SOLANA && r.toChainId === SOLANA && !r.recipient,
    async quote(req: QuoteRequest, signal) {
      const inMint = toMint(req.fromToken);
      const outMint = toMint(req.toToken);
      const held = owner && bps > 0 ? await accounts() : new Map<string, string>();
      // /build always takes platformFeeBps from the output (measured), so the fee account must be
      // the fee wallet's account for the output mint.
      const feeAccount = held.get(outMint);
      const q = new URLSearchParams({
        inputMint: inMint,
        outputMint: outMint,
        amount: req.amount,
        taker: req.taker ?? placeholderFor(SOLANA),
        slippageBps: String(req.slippageBps),
        computeUnitPricePercentile: "medium",
        ...(feeAccount ? { platformFeeBps: String(bps), feeAccount } : {}),
      });
      const r = await getJson<JupBuild>(f, `${BASE}/build?${q}`, { headers, signal });
      if (r.error || !r.outAmount) throw new Error(r.error ?? "no route");
      const [sol, outUsd] = await Promise.all([
        pricer.token(SOLANA, SOL_NATIVE).catch(() => null),
        pricer.usd(SOLANA, req.toToken, r.outAmount).catch(() => null),
      ]);
      const lamports =
        5000n + (cuPrice(r.computeBudgetInstructions) * BigInt(CU_LIMIT)) / 1_000_000n;
      const gasUsd = (Number(lamports) / 1e9) * (sol?.priceUsd ?? 0);
      // ExactIn: outAmount is already net of our fee when it's taken in the output mint.
      const ourFeeUsd = feeAccount && outUsd !== null ? (outUsd * bps) / (10_000 - bps) : 0;
      const instructions = [
        cuLimitIx(CU_LIMIT),
        ...r.computeBudgetInstructions,
        ...r.setupInstructions,
        r.swapInstruction,
        ...(r.cleanupInstruction ? [r.cleanupInstruction] : []),
        ...r.otherInstructions,
        ...(r.tipInstruction ? [r.tipInstruction] : []),
      ].map((ix) => ("accounts" in ix ? toRelayIx(ix) : ix));
      return Quote.parse({
        id: `jupiter:${crypto.randomUUID()}`,
        provider: "jupiter",
        request: req,
        toAmount: r.outAmount,
        toAmountMin: r.otherAmountThreshold,
        gasUsd,
        feeUsd: ourFeeUsd,
        netUsd: outUsd === null ? null : outUsd - gasUsd,
        etaSeconds: 2,
        steps: [
          {
            type: "swap",
            tool: `jupiter${r.routePlan[0] ? `:${r.routePlan.map((p) => p.swapInfo.label).join("+")}` : ""}`,
            fromChainId: SOLANA,
            toChainId: SOLANA,
            fromToken: req.fromToken,
            toToken: req.toToken,
            fromAmount: req.amount,
            toAmount: r.outAmount,
          },
        ],
        approvalAddress: null,
        tx: null,
        expiresAt: Date.now() + 30_000,
        ourFeeUsd,
        ourFeeVerified: Boolean(feeAccount),
        ...(feeAccount && owner ? { feeRecipient: { address: owner, chainId: SOLANA } } : {}),
        ...(req.taker
          ? {
              execution: "nonevm" as const,
              nonEvmTx: {
                vm: "svm",
                kind: "svm-instructions",
                data: {
                  instructions,
                  addressLookupTableAddresses: Object.keys(r.addressesByLookupTableAddress ?? {}),
                },
              },
            }
          : {}),
      });
    },
    async status(req, signal) {
      const r = await getJson<{
        result?: { value: ({ err: unknown; confirmationStatus?: string } | null)[] };
      }>(f, env.SOLANA_RPC_URL ?? env.RPC_URL_792703809 ?? "https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[req.txHash], { searchTransactionHistory: true }],
        }),
      });
      const s = r.result?.value?.[0];
      return StatusResponse.parse({
        status: !s
          ? "not_found"
          : s.err
            ? "failed"
            : s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized"
              ? "done"
              : "pending",
        receivingTxHash: s && !s.err ? req.txHash : null,
      });
    },
  };
}
