/**
 * Where a wallet-aware lookup page should send a connected wallet.
 * - On the landing page (no address in the URL): straight to `${base}/${connected}`.
 * - On a result page for a DIFFERENT address (e.g. a shared link): never redirect; the page offers
 *   a "check my wallet" link instead, so someone viewing another address is not hijacked.
 * - Otherwise: nothing.
 */
export function walletTarget(
  base: string,
  connected: string | undefined,
  current: string | undefined,
): { auto: string | null; offer: string | null } {
  const c = connected?.trim();
  if (!c) return { auto: null, offer: null };
  const href = `${base}/${encodeURIComponent(c)}`;
  if (!current?.trim()) return { auto: href, offer: null };
  if (current.trim().toLowerCase() === c.toLowerCase()) return { auto: null, offer: null };
  return { auto: null, offer: href };
}
