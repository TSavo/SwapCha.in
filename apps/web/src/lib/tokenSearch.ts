import type { Token } from "@swapchan/shared";

/**
 * Ranks tokens for the picker search. Lower is better; null = no match.
 * Exact symbol > symbol prefix > name prefix > word in name > symbol/name substring > address.
 * Ties keep list order (the list is sorted by market cap, so popular coins come first).
 */
export function tokenScore(
  t: Pick<Token, "symbol" | "name" | "address">,
  query: string,
): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const s = t.symbol.toLowerCase();
  const n = t.name.toLowerCase();
  const a = t.address.toLowerCase();
  if (s === q) return 0;
  if (s.startsWith(q)) return 1;
  if (n === q || n.startsWith(q)) return 2;
  if (n.split(/[\s\-_.()]+/).some((w) => w.startsWith(q))) return 3;
  if (s.includes(q) || n.includes(q)) return 4;
  if (q.length >= 3 && (a === q || a.startsWith(q))) return 5;
  return null;
}

export function searchTokens<T extends Pick<Token, "symbol" | "name" | "address">>(
  tokens: T[],
  query: string,
): T[] {
  return tokens
    .map((t, i) => ({ t, i, s: tokenScore(t, query) }))
    .filter((x): x is { t: T; i: number; s: number } => x.s !== null)
    .sort((x, y) => x.s - y.s || x.i - y.i)
    .map((x) => x.t);
}
