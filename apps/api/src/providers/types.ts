import type { Quote, QuoteRequest, StatusRequest, StatusResponse } from "@swapchan/shared";

/** Every aggregator/bridge implements this. Add one file per provider + register in index.ts. */
export interface ProviderAdapter {
  readonly name: string;
  /** False when required env keys are missing; such providers are skipped. */
  enabled(): boolean;
  supports(req: QuoteRequest): boolean;
  quote(req: QuoteRequest, signal: AbortSignal): Promise<Quote>;
  status?(req: StatusRequest, signal: AbortSignal): Promise<StatusResponse>;
}

export type Fetch = typeof fetch;

export async function getJson<T>(f: Fetch, url: string, init: RequestInit): Promise<T> {
  const res = await f(url, init);
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}
