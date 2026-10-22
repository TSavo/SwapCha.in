/**
 * Embeddable widget (/embed): config from the iframe URL, partner attribution, and
 * postMessage events to the host page. Outside an iframe/embed everything here is a no-op.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export interface EmbedConfig {
  partner?: string;
  theme: "dark" | "light";
  /** CSS color for buttons/highlights, e.g. #22c55e. */
  accent?: string;
  /** Show Swap-chan and the chain characters. */
  chan: boolean;
  compact: boolean;
  /** Destination chain/token can't be changed ("buy our token"). */
  lockTo: boolean;
}

const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgb\([\d\s,.%]+\))$/i;
const PARTNER = /^[a-z0-9-]{3,40}$/;
const on = (v: string | null, dflt: boolean) =>
  v === null ? dflt : !["0", "false", "no", "off"].includes(v.toLowerCase());

export function parseEmbedConfig(sp: URLSearchParams): EmbedConfig {
  const partner = sp.get("partner") ?? "";
  const accent = sp.get("accent") ?? "";
  return {
    ...(PARTNER.test(partner) ? { partner } : {}),
    theme: sp.get("theme") === "light" ? "light" : "dark",
    ...(COLOR.test(accent) ? { accent } : {}),
    chan: on(sp.get("chan"), true),
    compact: on(sp.get("compact"), false),
    lockTo: on(sp.get("lockTo"), false),
  };
}

let current: EmbedConfig | null = null;
/** Called once by the /embed page; turns on attribution + host events. */
export function setEmbed(c: EmbedConfig): void {
  current = c;
}
export const embedConfig = (): EmbedConfig | null => current;
export const embedPartner = (): string | undefined => current?.partner;

export type HostEvent = "ready" | "quote" | "swap_submitted" | "swap_completed" | "resize";

/** postMessage to the host page: {source:"swapchan", type, ...data}. */
export function emit(type: HostEvent, data: Record<string, unknown> = {}): void {
  if (!current || typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    { source: "swapchan", type, partner: current.partner ?? null, ...data },
    "*",
  );
}

/** GA event -> host event, plus revenue-share attribution for submitted swaps. */
export function onTrack(name: string, params: Record<string, unknown>): void {
  if (!current) return;
  const pick = {
    provider: params.provider,
    fromChainId: params.from_chain,
    toChainId: params.to_chain,
    usdValue: params.usd_value,
  };
  if (name === "quote_received") emit("quote", { ...pick, routes: params.routes });
  if (name === "swap_completed") emit("swap_completed", pick);
  if (name === "swap_submitted") {
    emit("swap_submitted", { ...pick, txHash: params.tx_hash });
    const partner = current.partner;
    if (partner && params.quote_id && params.tx_hash)
      void fetch(`${API_URL}/partners/${partner}/swaps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId: params.quote_id,
          txHash: params.tx_hash,
          ...(params.taker ? { taker: params.taker } : {}),
        }),
      }).catch(() => {});
  }
}

/** Snippet builders shared by /widget and tests. */
export interface SnippetOptions {
  partner?: string;
  theme?: "dark" | "light";
  accent?: string;
  chan?: boolean;
  compact?: boolean;
  lockTo?: boolean;
  fromChain?: number;
  toChain?: number;
  fromToken?: string;
  toToken?: string;
  amount?: string;
}

export function embedParams(o: SnippetOptions): URLSearchParams {
  const sp = new URLSearchParams();
  if (o.partner) sp.set("partner", o.partner);
  if (o.fromChain) sp.set("fromChain", String(o.fromChain));
  if (o.fromToken) sp.set("fromToken", o.fromToken);
  if (o.toChain) sp.set("toChain", String(o.toChain));
  if (o.toToken) sp.set("toToken", o.toToken);
  if (o.amount) sp.set("amount", o.amount);
  if (o.theme === "light") sp.set("theme", "light");
  if (o.accent) sp.set("accent", o.accent);
  if (o.chan === false) sp.set("chan", "0");
  if (o.compact) sp.set("compact", "1");
  if (o.lockTo) sp.set("lockTo", "1");
  return sp;
}

const ATTR: Record<string, string> = {
  partner: "data-partner",
  fromChain: "data-from-chain",
  fromToken: "data-from-token",
  toChain: "data-to-chain",
  toToken: "data-to-token",
  amount: "data-amount",
  theme: "data-theme",
  accent: "data-accent",
  chan: "data-chan",
  compact: "data-compact",
  lockTo: "data-lock-to",
};

export function scriptSnippet(o: SnippetOptions, origin = "https://swapchan.com"): string {
  const attrs = [...embedParams(o)].map(([k, v]) => ` ${ATTR[k] ?? `data-${k}`}="${v}"`).join("");
  return `<script src="${origin}/widget.js"${attrs} async></script>`;
}

export function iframeSnippet(o: SnippetOptions, origin = "https://swapchan.com"): string {
  const h = o.compact ? 560 : 720;
  return `<iframe src="${origin}/embed?${embedParams(o).toString().replace(/&/g, "&amp;")}" width="420" height="${h}" style="border:0;max-width:100%" allow="clipboard-write" title="SwapChan swap"></iframe>`;
}
