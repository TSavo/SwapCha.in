import type { Quote } from "@swapchan/shared";
import { embedConfig, embedPartner, onTrack } from "./embed";
import { gaParams } from "./gaUrl";

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";

type Gtag = (cmd: "event", name: string, params: Record<string, unknown>) => void;

/** Fire a GA4 event; no-op when GA is not configured or not loaded. */
export function track(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  onTrack(name, params); // widget: host events + partner attribution (no-op on swapchan.com)
  if (!GA_ID) return;
  const embed = embedConfig();
  // GA never gets addresses or tx hashes (host/partner callbacks above keep the full params).
  params = gaParams(params);
  if (embed) params = { ...params, embedded: true, partner: embedPartner() ?? "none" };
  const g = (window as unknown as { gtag?: Gtag }).gtag;
  g?.("event", name, params);
  if (embed && name === "swap_completed") g?.("event", "widget_swap_completed", params);
}

/** Common swap params: provider, chains, USD value, our fee. */
export function quoteParams(q: Quote): Record<string, unknown> {
  return {
    provider: q.provider,
    from_chain: q.request.fromChainId,
    to_chain: q.request.toChainId,
    cross_chain: q.request.fromChainId !== q.request.toChainId,
    value: q.netUsd ?? 0,
    currency: "USD",
    usd_value: q.netUsd ?? 0,
    our_fee_usd: q.ourFeeUsd ?? 0,
    our_fee_verified: q.ourFeeVerified ?? false,
    quote_id: q.id,
  };
}
