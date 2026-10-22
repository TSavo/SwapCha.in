import type { Quote, QuoteRequest, QuotesResponse } from "@swapchan/shared";
import type { ProviderAdapter } from "./providers/types.js";

/** Best first: priced quotes by netUsd, then unpriced by raw toAmount (bigint). */
export function rank(quotes: Quote[]): Quote[] {
  return [...quotes].sort((a, b) => {
    if (a.netUsd !== null && b.netUsd !== null) return b.netUsd - a.netUsd;
    if (a.netUsd !== null) return -1;
    if (b.netUsd !== null) return 1;
    const d = BigInt(b.toAmount) - BigInt(a.toAmount);
    return d > 0n ? 1 : d < 0n ? -1 : 0;
  });
}

export async function fanOut(
  providers: ProviderAdapter[],
  req: QuoteRequest,
  timeoutMs = 8000,
): Promise<QuotesResponse> {
  const active = providers.filter((p) => p.enabled() && p.supports(req));
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
  const ranked = rank(quotes);
  return { quotes: ranked, best: ranked[0]?.id ?? null, errors };
}
