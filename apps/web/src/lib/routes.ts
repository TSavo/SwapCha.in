import { SUPPORTED_CHAINS, vmOf } from "@swapchan/shared";
import { BIOS } from "./bios";
import { type CharacterKey, characterForChain } from "./characters";
import data from "./routes.json";

export interface RouteToken {
  symbol: string;
  address: string;
  decimals: number;
}
export interface SeoRoute {
  slug: string;
  fromChainId: number;
  toChainId: number;
  fromToken: RouteToken;
  toToken: RouteToken;
  /** Human amount used for the live sample quote. */
  amount: string;
  /** Providers that quoted when the route list was generated (scripts/probe-routes.mjs). */
  providers: string[];
}

/** Routes that actually quoted at generation time. Regenerate: node apps/web/scripts/probe-routes.mjs */
export const ROUTES: SeoRoute[] = data as SeoRoute[];
const BY_SLUG = new Map(ROUTES.map((r) => [r.slug, r]));
export const routeBySlug = (slug: string) => BY_SLUG.get(slug);

export const chainName = (id: number) =>
  SUPPORTED_CHAINS[id as keyof typeof SUPPORTED_CHAINS]?.name ?? String(id);
export const chainKey = (id: number): CharacterKey => characterForChain(id).key;
export const isBridge = (r: SeoRoute) => r.fromChainId !== r.toChainId;
export const routeHref = (r: SeoRoute) => `/swap/${r.slug}`;

/** "bridge" for same-asset cross-chain moves, "swap" otherwise. */
export const verb = (r: SeoRoute) =>
  isBridge(r) && r.fromToken.symbol === r.toToken.symbol ? "bridge" : "swap";

export function title(r: SeoRoute): string {
  const a = `${r.fromToken.symbol} on ${chainName(r.fromChainId)}`;
  const b = isBridge(r) ? `${r.toToken.symbol} on ${chainName(r.toChainId)}` : r.toToken.symbol;
  return `Cheapest way to ${verb(r)} ${a} to ${b}`;
}

export const deepLink = (r: SeoRoute) =>
  `/?${new URLSearchParams({
    fromChain: String(r.fromChainId),
    toChain: String(r.toChainId),
    fromToken: r.fromToken.address,
    toToken: r.toToken.address,
    amount: r.amount,
  })}`;

const PROVIDER_NAMES: Record<string, string> = {
  lifi: "LI.FI",
  relay: "Relay",
  across: "Across",
  cow: "CoW Protocol",
  velora: "Velora",
  "0x": "0x",
  zerox: "0x",
};
export const providerName = (p: string) => PROVIDER_NAMES[p] ?? p;

/** Short, route-specific copy built from the chain bios and the route's shape. */
export function blurb(r: SeoRoute): string[] {
  const f = chainName(r.fromChainId);
  const t = chainName(r.toChainId);
  const fb = BIOS[chainKey(r.fromChainId)];
  const tb = BIOS[chainKey(r.toChainId)];
  const provs = r.providers.map(providerName).join(", ");
  const crossVm = vmOf(r.fromChainId) !== vmOf(r.toChainId);
  const out: string[] = [];
  if (!isBridge(r))
    out.push(
      `Swapping ${r.fromToken.symbol} for ${r.toToken.symbol} on ${f} is a single on-chain trade, so the best price comes down to liquidity and gas. SwapChan asks ${provs} at the same time and ranks every route by what actually lands in your wallet after gas and fees.`,
    );
  else
    out.push(
      `Moving ${r.fromToken.symbol} from ${f} to ${r.toToken.symbol} on ${t} means a bridge${r.fromToken.symbol !== r.toToken.symbol ? " plus a swap" : ""}. SwapChan quotes ${provs} side by side and prices every output with the same market price, so the cheapest route wins, not the one with the loudest estimate.`,
    );
  out.push(
    `${f} is known for ${fb.facts.knownFor.charAt(0).toLowerCase()}${fb.facts.knownFor.slice(1).replace(/\.$/, "")}${isBridge(r) ? `, while ${t} is known for ${tb.facts.knownFor.charAt(0).toLowerCase()}${tb.facts.knownFor.slice(1).replace(/\.$/, "")}` : ""}.`,
  );
  if (crossVm)
    out.push(
      `${f} and ${t} use different address formats, so you'll paste a ${t} receiving address before you swap. Your wallet signs the transaction; SwapChan never holds your keys or funds.`,
    );
  else
    out.push(
      "Connect your wallet, check the routes below, and sign. SwapChan never holds your keys or funds; you send the transaction straight to the provider's contract.",
    );
  return out;
}

export function faq(r: SeoRoute): { q: string; a: string }[] {
  const f = chainName(r.fromChainId);
  const t = chainName(r.toChainId);
  const provs = r.providers.map(providerName).join(", ");
  return [
    {
      q: `What is the cheapest way to ${verb(r)} ${r.fromToken.symbol} on ${f} to ${r.toToken.symbol}${isBridge(r) ? ` on ${t}` : ""}?`,
      a: `It changes minute to minute. SwapChan compares ${provs} live and picks the route that delivers the most ${r.toToken.symbol} after gas and fees. The table on this page shows the current ranking.`,
    },
    {
      q: `How long does it take?`,
      a: isBridge(r)
        ? `Most ${f} to ${t} routes settle in seconds to a few minutes; each route above shows its estimated time. Bitcoin legs wait for block confirmations and can take longer.`
        : `A same-chain swap on ${f} settles as soon as the transaction is included in a block, usually seconds.`,
    },
    {
      q: "Does SwapChan charge a fee?",
      a: "SwapChan adds a 0.1% fee, already included in every quote you see, so the amount shown is what you receive. Routes are ranked as if they all carried it, so the fee never changes which route wins.",
    },
    {
      q: "Is it safe?",
      a: "SwapChan is non-custodial: your own wallet signs and sends the transaction to the provider's audited contracts. Unlisted tokens are flagged as unverified before you swap.",
    },
  ];
}

/** Related routes for internal linking: reverse, same origin, same destination. */
export function related(r: SeoRoute, n = 8): SeoRoute[] {
  const rev = ROUTES.find(
    (x) =>
      x.fromChainId === r.toChainId &&
      x.toChainId === r.fromChainId &&
      x.fromToken.symbol === r.toToken.symbol &&
      x.toToken.symbol === r.fromToken.symbol,
  );
  const sameFrom = ROUTES.filter(
    (x) => x !== r && x.fromChainId === r.fromChainId && x.fromToken.symbol === r.fromToken.symbol,
  );
  const sameTo = ROUTES.filter(
    (x) => x !== r && x.toChainId === r.toChainId && x.toToken.symbol === r.toToken.symbol,
  );
  const out: SeoRoute[] = [];
  for (const x of [rev, ...sameFrom.slice(0, 4), ...sameTo.slice(0, 4), ...sameFrom.slice(4)])
    if (x && x !== r && !out.includes(x) && out.length < n) out.push(x);
  return out;
}
