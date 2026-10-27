import {
  isReceiveOnly,
  type Quote,
  type QuoteRequest,
  type QuotesResponse,
} from "@swapchan/shared";
import { failures, type GuardCtx, quotePayload, verifyPayload } from "./guard/index.js";
import type { Pricer } from "./pricing.js";
import type { ProviderAdapter } from "./providers/types.js";

/** Loud, grep-able log line for a payload that failed verification. */
export function logGuardFailure(stage: string, provider: string, chainId: number, reason: string) {
  console.error(
    `GUARD_REJECT ${JSON.stringify({ stage, provider, chainId, reason, at: new Date().toISOString() })}`,
  );
}

/** Verify every quote; drop (and report) the ones whose payload fails. Fail closed. */
export async function guardQuotes(
  quotes: Quote[],
  guard: GuardCtx,
  errors: QuotesResponse["errors"],
): Promise<Quote[]> {
  const out: Quote[] = [];
  for (const [q, v] of await Promise.all(
    quotes.map(async (q) => [q, await verifyPayload(quotePayload(q), guard)] as const),
  )) {
    const failed = v.checks.some((c) => !c.ok);
    if (failed) {
      const reason = failures(v);
      logGuardFailure("quote", q.provider, q.request.fromChainId, reason);
      errors.push({ provider: q.provider, message: `rejected by payload verification: ${reason}` });
      continue;
    }
    out.push({ ...q, verified: v.verified, verification: v });
  }
  return out;
}

/** Best first: priced quotes by netUsd, then unpriced by raw toAmount (bigint). */
export function rank(quotes: Quote[], feeBps = 0): Quote[] {
  // A route that pays us nothing is ranked as if it carried our fee, so it only wins when
  // it beats fee-paying routes by more than our cut.
  const key = (q: Quote) =>
    q.netUsd === null
      ? null
      : q.ourFeeVerified
        ? q.netUsd
        : q.netUsd - (q.netUsd * feeBps) / 10_000;
  return [...quotes].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== null && kb !== null) return kb - ka;
    if (ka !== null) return -1;
    if (kb !== null) return 1;
    const d = BigInt(b.toAmount) - BigInt(a.toAmount);
    return d > 0n ? 1 : d < 0n ? -1 : 0;
  });
}

export async function fanOut(
  providers: ProviderAdapter[],
  req: QuoteRequest,
  timeoutMs = 8000,
  feeBps = Number(process.env.SWAPCHAN_FEE_BPS ?? 0),
  pricer: Pricer | null = null,
  guard: GuardCtx | null = null,
): Promise<QuotesResponse> {
  // Receive-only UTXO chains (LTC/DOGE/BCH) are THORChain payouts only; no other provider routes them.
  const utxo = isReceiveOnly(req.fromChainId) || isReceiveOnly(req.toChainId);
  const active = providers.filter(
    (p) => p.enabled() && (!utxo || p.name === "thorchain") && p.supports(req),
  );
  const signal = AbortSignal.timeout(timeoutMs);
  const settled = await Promise.allSettled(active.map((p) => p.quote(req, signal)));
  const quotes: Quote[] = [];
  const errors: QuotesResponse["errors"] = [];
  settled.forEach((s, i) => {
    const provider = active[i]?.name ?? "unknown";
    if (s.status === "fulfilled") quotes.push(s.value);
    else
      errors.push({
        provider,
        message: s.reason instanceof Error ? s.reason.message : String(s.reason),
      });
  });
  const safe = guard ? await guardQuotes(quotes, guard, errors) : quotes;
  const ranked = rank(pricer ? await repriceAll(safe, req, pricer) : safe, feeBps);
  return { quotes: ranked, best: ranked[0]?.id ?? null, errors };
}

/**
 * Never trust provider-reported USD: re-price every route's output with one token price
 * (ours), so routes are compared on tokens received. netUsd = toAmount * price - gasUsd.
 * If we can't price the output token, all routes fall back to raw toAmount ranking.
 */
export async function repriceAll(
  quotes: Quote[],
  req: QuoteRequest,
  pricer: Pricer,
): Promise<Quote[]> {
  const t = await pricer.token(req.toChainId, req.toToken).catch(() => null);
  const price = t?.priceUsd ?? 0;
  if (!t || !(price > 0)) return quotes.map((q) => ({ ...q, netUsd: null }));
  return quotes.map((q) => ({
    ...q,
    netUsd: (Number(BigInt(q.toAmount)) / 10 ** t.decimals) * price - q.gasUsd,
  }));
}
