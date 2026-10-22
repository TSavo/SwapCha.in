import { formatUnits } from "viem";
import type { Fetch } from "./providers/types.js";

export interface TokenInfo {
  priceUsd: number | null;
  decimals: number;
}
export interface Pricer {
  token(chainId: number, address: string): Promise<TokenInfo | null>;
  /** USD value of a base-unit amount, or null if unpriced. */
  usd(chainId: number, address: string, amount: bigint | string): Promise<number | null>;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const LLAMA_CHAIN: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon",
  56: "bsc",
  43114: "avax",
  59144: "linea",
  534352: "scroll",
};
const NATIVE_GECKO: Record<number, string> = {
  1: "ethereum",
  8453: "ethereum",
  42161: "ethereum",
  10: "ethereum",
  137: "polygon-ecosystem-token",
  56: "binancecoin",
  43114: "avalanche-2",
  59144: "ethereum",
  534352: "ethereum",
};
const isNative = (a: string) =>
  a.toLowerCase() === ZERO_ADDRESS ||
  a.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** Keyless USD prices via DefiLlama coins API (independent of quote providers' rate limits), cached 60s. */
export function llamaPricer(
  f: Fetch = fetch,
  ttlMs = 60_000,
  decimalsOf?: (chainId: number, address: string) => Promise<number | null>,
): Pricer {
  const cache = new Map<string, { at: number; v: Promise<TokenInfo | null> }>();
  const token = (chainId: number, address: string) => {
    const id = isNative(address)
      ? `coingecko:${NATIVE_GECKO[chainId] ?? "ethereum"}`
      : `${LLAMA_CHAIN[chainId] ?? chainId}:${address.toLowerCase()}`;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < ttlMs) return hit.v;
    const v = f(`https://coins.llama.fi/prices/current/${id}`, {
      signal: AbortSignal.timeout(5000),
    })
      .then(async (r) => {
        if (!r.ok) return null;
        const c = (
          (await r.json()) as { coins: Record<string, { price?: number; decimals?: number }> }
        ).coins[id];
        if (!c) {
          const d = decimalsOf ? await decimalsOf(chainId, address) : null;
          return d === null ? null : { priceUsd: null, decimals: d };
        }
        return { priceUsd: c.price ?? null, decimals: c.decimals ?? 18 };
      })
      .catch(() => null);
    cache.set(id, { at: Date.now(), v });
    return v;
  };
  return {
    token,
    async usd(chainId, address, amount) {
      const t = await token(chainId, address);
      if (!t || t.priceUsd === null) return null;
      return Number(formatUnits(BigInt(amount), t.decimals)) * t.priceUsd;
    },
  };
}
