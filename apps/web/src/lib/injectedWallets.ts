/** Minimal wagmi connector shape we need to list wallets. */
export interface PickableConnector {
  id: string;
  name: string;
  icon?: string | undefined;
}

/**
 * Wallets to offer when there is no Reown project id: every EIP-6963-announced wallet
 * (wagmi adds them as connectors, id = rdns), plus the generic `injected` one only when
 * nothing announced itself (old wallets that just set window.ethereum).
 */
export function pickableConnectors<C extends PickableConnector>(connectors: readonly C[]): C[] {
  const seen = new Set<string>();
  const out: C[] = [];
  for (const c of connectors) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  const announced = out.filter((c) => c.id !== "injected");
  return announced.length > 0 ? announced : out;
}

/** Only data: or https: icons (EIP-6963 says data URIs; never let a wallet inject script URLs). */
export const safeIcon = (icon?: string) =>
  icon && /^(data:image\/(png|svg\+xml|webp|jpeg|gif);|https:\/\/)/.test(icon) ? icon : undefined;
