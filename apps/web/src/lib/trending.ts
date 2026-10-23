import { nativeOf, SOLANA, tokenList } from "@swapchan/shared";

const API =
  process.env.SWAPCHAN_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export type TrendChain = "solana" | "base" | "eth" | "bnb";
export interface TrendToken {
  key: string;
  chain: TrendChain;
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  riskLevel: string;
  riskFlags: string[];
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  indexable: boolean;
  firstSeen: number;
  lastSeen: number;
}
export interface TrendMarket {
  priceUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  dex: string | null;
  pairUrl: string | null;
  fetchedAt: string;
}

export const CHAIN_LABEL: Record<TrendChain, string> = {
  solana: "Solana",
  base: "Base",
  eth: "Ethereum",
  bnb: "BNB Chain",
};
const NATIVE: Record<TrendChain, { sym: string; amount: string }> = {
  solana: { sym: "sol", amount: "1" },
  base: { sym: "eth", amount: "0.05" },
  eth: { sym: "eth", amount: "0.05" },
  bnb: { sym: "bnb", amount: "0.2" },
};

/** The two entry pages per token: <native>-to-<key> and usdc-to-<key>. */
export function trendSlugs(t: Pick<TrendToken, "chain" | "key">): string[] {
  return [`${NATIVE[t.chain].sym}-to-${t.key}`, `usdc-to-${t.key}`];
}

/** Split "sol-to-wif" into its input side and token key; null when it isn't a trending slug shape. */
export function parseTrendSlug(slug: string): { from: string; key: string } | null {
  const m = /^(sol|eth|bnb|usdc)-to-([a-z0-9-]{1,60})$/.exec(slug);
  return m ? { from: m[1]!, key: m[2]! } : null;
}

/** Input token for the page's swap card, or null when the slug's input doesn't fit the token's chain. */
export function inputFor(t: TrendToken, from: string) {
  if (from === "usdc") {
    const u = tokenList.find((x) => x.chainId === t.chainId && x.symbol === "USDC");
    return u ? { symbol: "USDC", address: u.address, amount: "100" } : null;
  }
  const n = NATIVE[t.chain];
  if (n.sym !== from) return null;
  return { symbol: from.toUpperCase(), address: nativeOf(t.chainId), amount: n.amount };
}

export const explorerUrl = (t: TrendToken): string =>
  t.chainId === SOLANA
    ? `https://solscan.io/token/${t.address}`
    : ({ 1: "https://etherscan.io", 8453: "https://basescan.org", 56: "https://bscscan.com" }[
        t.chainId
      ] ?? "https://etherscan.io") + `/token/${t.address}`;

export async function trendingTokens(): Promise<TrendToken[]> {
  try {
    const r = await fetch(`${API}/seo/tokens`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? ((await r.json()) as { tokens: TrendToken[] }).tokens : [];
  } catch {
    return [];
  }
}

export async function trendingToken(
  key: string,
): Promise<{ token: TrendToken; market: TrendMarket | null } | null> {
  try {
    const r = await fetch(`${API}/seo/tokens/${encodeURIComponent(key)}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export function trendFaq(t: TrendToken, input: string): { q: string; a: string }[] {
  const c = CHAIN_LABEL[t.chain];
  return [
    {
      q: `How do I buy ${t.name} (${t.symbol})?`,
      a: `Connect a ${c} wallet, choose ${input} as the token you pay with, and swap for ${t.symbol} in the card on this page. SwapChan compares every major aggregator and bridge live and picks the route that lands the most ${t.symbol} after gas and fees. You can also pay from another chain; cross-chain routes are quoted too.`,
    },
    {
      q: `What is the ${t.symbol} contract address?`,
      a: `${t.name} (${t.symbol}) on ${c}: ${t.address}. Always check the address before you swap; copycat tokens often reuse the same name and ticker.`,
    },
    {
      q: `Is ${t.symbol} safe?`,
      a: `Automated checks rate it ${t.riskLevel} risk${t.riskFlags.length ? ` (flags: ${t.riskFlags.join(", ")})` : ""}. These checks (${t.chain === "solana" ? "RugCheck and Jupiter" : "GoPlus"} plus market data) are heuristics and can miss things. Trending tokens are very volatile; only swap what you can afford to lose.`,
    },
    {
      q: "Does SwapChan charge a fee?",
      a: "SwapChan adds a 0.1% fee, already included in every quote, so the amount shown is what you receive. SwapChan is non-custodial: your wallet signs and sends the transaction straight to the provider.",
    },
  ];
}
