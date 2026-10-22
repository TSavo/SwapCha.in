import { isEvmChain, NON_EVM, SOLANA, tokenList } from "@swapchan/shared";
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
  792703809: "solana",
  728126428: "tron",
  8253038: "bitcoin",
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
  792703809: "solana",
  8253038: "bitcoin",
  728126428: "tron",
};
const isNative = (a: string, chainId = 1) =>
  NON_EVM[chainId]?.native === a ||
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
    const id = isNative(address, chainId)
      ? `coingecko:${NATIVE_GECKO[chainId] ?? "ethereum"}`
      : `${LLAMA_CHAIN[chainId] ?? chainId}:${isEvmChain(chainId) ? address.toLowerCase() : address}`;
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
          if (chainId === SOLANA) {
            // Fresh memecoins: DefiLlama lags; Jupiter's price API has them from the first pool.
            const j = await f(`https://api.jup.ag/price/v3?ids=${address}`, {
              signal: AbortSignal.timeout(4000),
            })
              .then((x) => (x.ok ? x.json() : null))
              .catch(() => null);
            const e = (j as Record<string, { usdPrice?: number; decimals?: number }> | null)?.[
              address
            ];
            if (e?.decimals !== undefined)
              return { priceUsd: e.usdPrice ?? null, decimals: e.decimals };
          }
          const d = decimalsOf ? await decimalsOf(chainId, address) : null;
          return d === null ? null : { priceUsd: null, decimals: d };
        }
        // coingecko: ids carry no decimals; use our list (SOL 9, BTC 8, TRX 6) before assuming 18.
        const listed = tokenList.find(
          (t) => t.chainId === chainId && t.address.toLowerCase() === address.toLowerCase(),
        );
        return { priceUsd: c.price ?? null, decimals: c.decimals ?? listed?.decimals ?? 18 };
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
