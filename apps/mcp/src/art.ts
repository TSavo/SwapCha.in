/** Chain-chan mascots for tool results: every response shows the relevant chans + a swap link. */
export const SITE = "https://swapchan.com";

const CHANS: Record<number, { key: string; name: string }> = {
  1: { key: "ethereum", name: "Ethereum-chan" },
  8453: { key: "base", name: "Base-chan" },
  42161: { key: "arbitrum", name: "Arbitrum-chan" },
  10: { key: "optimism", name: "Optimism-chan" },
  137: { key: "polygon", name: "Polygon-chan" },
  56: { key: "bnb", name: "BNB-chan" },
  43114: { key: "avalanche", name: "Avalanche-chan" },
  59144: { key: "linea", name: "Linea-chan" },
  534352: { key: "scroll", name: "Scroll-chan" },
  792703809: { key: "solana", name: "Solana-chan" },
  8253038: { key: "bitcoin", name: "Bitcoin-chan" },
  728126428: { key: "tron", name: "Tron-chan" },
};

export interface Mascot {
  name: string;
  imageUrl: string;
  alt: string;
  markdown: string;
}

const mk = (key: string, name: string, role: string): Mascot => {
  const imageUrl = `${SITE}/characters/${key}.png`;
  const alt = `${name}, ${role}`;
  return { name, imageUrl, alt, markdown: `![${alt}](${imageUrl})` };
};

export const SWAP_CHAN = mk("swapchan", "Swap-chan", "SwapChan's mascot");

export function mascotsFor(fromChainId?: number, toChainId?: number): Mascot[] {
  const out = [SWAP_CHAN];
  const f = fromChainId ? CHANS[fromChainId] : undefined;
  const t = toChainId ? CHANS[toChainId] : undefined;
  if (f) out.push(mk(f.key, f.name, "source chain"));
  if (t && toChainId !== fromChainId) out.push(mk(t.key, t.name, "destination chain"));
  return out;
}

export function swapUrl(p: {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  amount?: string | undefined;
  partner?: string | undefined;
  ref?: string | undefined;
}): string {
  const q = new URLSearchParams({
    fromChain: String(p.fromChainId),
    toChain: String(p.toChainId),
    fromToken: p.fromToken,
    toToken: p.toToken,
    ...(p.amount ? { amount: p.amount } : {}),
    ...((p.partner ?? p.ref) ? { ref: (p.partner ?? p.ref) as string } : {}),
  });
  return `${SITE}/?${q}`;
}

const cache = new Map<string, string>();
/** Cached base64 PNG for an MCP image content block; null if it can't be fetched. */
export async function imageData(url: string, f: typeof fetch = fetch): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  try {
    const r = await f(url, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    cache.set(url, b64);
    return b64;
  } catch {
    return null;
  }
}
