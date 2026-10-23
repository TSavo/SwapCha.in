import type { SwapInitial } from "@/components/SwapCard";

/** Server-side reads of the SwapChan intel API (/onchain/*). Never throws: null on failure. */
export const SERVER_API =
  process.env.SWAPCHAN_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export interface Next {
  label: string;
  swapUrl: string;
}
export type Intel = Record<string, unknown> & { next?: Next; error?: string };

export async function intel(
  path: string,
  revalidate = 120,
  timeoutMs = 25_000,
): Promise<Intel | null> {
  try {
    const r = await fetch(`${SERVER_API}${path}`, {
      next: { revalidate },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await r.json()) as Intel;
    return r.ok ? j : { error: j?.error ?? `HTTP ${r.status}` };
  } catch (e) {
    return {
      error:
        e instanceof Error && e.name === "TimeoutError"
          ? "Timed out, try again"
          : "Unavailable right now",
    };
  }
}

/** Turn a swapchan.com deep link into SwapCard initial values (null when it has no route). */
export function initialFrom(url: string | undefined): SwapInitial | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const fc = Number(u.searchParams.get("fromChain"));
    if (!fc) return undefined;
    return {
      fromChain: fc,
      toChain: Number(u.searchParams.get("toChain")) || fc,
      fromToken: u.searchParams.get("fromToken") ?? "",
      toToken: u.searchParams.get("toToken") ?? "",
      amount: u.searchParams.get("amount") ?? "",
    };
  } catch {
    return undefined;
  }
}

export const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  eth: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  bnb: 56,
  bsc: 56,
  avalanche: 43114,
  solana: 792703809,
  tron: 728126428,
};
export const chainParam = (c: string) => CHAIN_IDS[c.toLowerCase()] ?? (Number(c) || 1);
export const CHAIN_NAME: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
  56: "BNB Chain",
  43114: "Avalanche",
  792703809: "Solana",
  728126428: "Tron",
};
export const usd = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: n < 1 ? 4 : 2,
      })
    : "–";
