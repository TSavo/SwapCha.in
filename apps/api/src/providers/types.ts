import type {
  BuildResponse,
  Quote,
  QuoteRequest,
  StatusRequest,
  StatusResponse,
} from "@swapchan/shared";
import { NON_EVM, vmOf } from "@swapchan/shared";

/** Every aggregator/bridge implements this. Add one file per provider + register in index.ts. */
export interface ProviderAdapter {
  readonly name: string;
  /** False when required env keys are missing; such providers are skipped. */
  enabled(): boolean;
  supports(req: QuoteRequest): boolean;
  quote(req: QuoteRequest, signal: AbortSignal): Promise<Quote>;
  /** Optional custom build (e.g. Permit2). Default: re-quote with taker and use quote.tx. */
  build?(req: QuoteRequest, signal: AbortSignal): Promise<BuildResponse>;
  status?(req: StatusRequest, signal: AbortSignal): Promise<StatusResponse>;
}

export type Fetch = typeof fetch;

export async function getJson<T>(f: Fetch, url: string, init: RequestInit): Promise<T> {
  const res = await f(url, init);
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Used for indicative quotes when no taker is given. */
export const PLACEHOLDER_TAKER = "0x000000000000000000000000000000000000dEaD";

/** Indicative-quote stand-ins per VM (Bitcoin needs a funded address: Relay checks UTXOs). */
const PLACEHOLDERS: Record<string, string> = {
  evm: PLACEHOLDER_TAKER,
  svm: "BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE",
  bvm: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo",
  tvm: "TULPYGfQ8U44XkhiX3oa3BaXdNPu6M5U3Z",
};
export const placeholderFor = (chainId: number): string =>
  // Receive-only UTXO coins: the chain's unspendable zero-hash sentinel (indicative quotes only; /build needs a
  // real, validated recipient).
  vmOf(chainId) === "uvm"
    ? NON_EVM[chainId]!.native
    : (PLACEHOLDERS[vmOf(chainId)] ?? PLACEHOLDER_TAKER);
