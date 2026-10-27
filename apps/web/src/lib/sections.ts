import { castOrder } from "@/lib/bios";
import { BT_EXAMPLES } from "@/lib/blocktools";
import { BT_ITEMS } from "@/lib/blocktoolsManifest";
import { CHAIN_FAMILIES, CHAIN_PAGES, chainHref } from "@/lib/chainPages";
import { DEV_TOOLS } from "@/lib/devTools";

export type Link = { href: string; label: string };
export type Group = { id: string; label: string; items: Link[] };
export type Section = {
  id: string;
  label: string;
  hub: string;
  /** Path prefixes that belong to this section (first match wins). */
  paths: string[];
  /** Short list shown in the sidebar when the section is active. */
  nav: Link[];
  groups: Group[];
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CAST_LABEL: Record<string, string> = { swapchan: "Swap-chan", bnb: "BNB" };

export const SECTIONS: Section[] = [
  {
    id: "swap",
    label: "Swap",
    hub: "/swap",
    paths: ["/swap", "/bridge", "/bridge-status", "/batch", "/rebalance"],
    nav: [
      { href: "/swap", label: "All swap routes" },
      { href: "/bridge", label: "Bridge" },
      { href: "/bridge-status", label: "Bridge status" },
      { href: "/batch", label: "Batch swap" },
      { href: "/rebalance", label: "Rebalance" },
    ],
    groups: [
      {
        id: "swap-tools",
        label: "Swap & bridge",
        items: [
          { href: "/", label: "Swap" },
          { href: "/bridge", label: "Bridge" },
          { href: "/bridge-status", label: "Bridge status" },
          { href: "/batch", label: "Batch swap" },
          { href: "/rebalance", label: "Rebalance" },
        ],
      },
    ],
  },
  {
    id: "find",
    label: "Find money",
    hub: "/find-money",
    paths: ["/find-money"],
    nav: [
      { href: "/find-money/guide", label: "Guide" },
      { href: "/find-money/powh3d", label: "PoWH3D check" },
      { href: "/airdrops", label: "Airdrop checker" },
    ],
    groups: [
      {
        id: "find-checks",
        label: "Specific checks",
        items: [
          { href: "/find-money/guide", label: "How to find forgotten crypto" },
          { href: "/find-money/powh3d", label: "PoWH3D & old dividend contracts" },
          { href: "/airdrops", label: "Unclaimed airdrops" },
          { href: "/wallet", label: "Wallet history & PnL" },
          { href: "/recover/seed-phrase", label: "Only have a seed phrase?" },
        ],
      },
    ],
  },
  {
    id: "wallet",
    label: "My wallet",
    hub: "/dashboard",
    paths: ["/dashboard", "/wallet", "/airdrops"],
    nav: [
      { href: "/wallet", label: "History & PnL" },
      { href: "/airdrops", label: "Airdrops" },
      { href: "/simulate", label: "Approvals & sim" },
    ],
    groups: [
      {
        id: "wallet-pages",
        label: "Your wallet",
        items: [
          { href: "/dashboard", label: "Dashboard" },
          { href: "/wallet", label: "History & PnL" },
          { href: "/airdrops", label: "Airdrops" },
          { href: "/simulate", label: "Simulate a tx / check approvals" },
          { href: "/rebalance", label: "Rebalance" },
        ],
      },
    ],
  },
  {
    id: "recover",
    label: "Recover",
    hub: "/recover",
    paths: ["/recover", "/tools/key-recovery"],
    nav: [
      { href: "/recover/seed-phrase", label: "Seed phrase" },
      { href: "/recover/keystore", label: "Keystore file" },
      { href: "/recover/ethereum-presale-wallet-2015", label: "2015 presale wallet" },
    ],
    groups: [
      {
        id: "recover-guides",
        label: "Recovery guides",
        items: [
          { href: "/recover/seed-phrase", label: "Seed phrase (missing words)" },
          { href: "/recover/keystore", label: "Keystore / JSON file" },
          {
            href: "/recover/ethereum-presale-wallet-2015",
            label: "Ethereum presale wallet (2015)",
          },
          { href: "/tools/key-recovery", label: "Why keys never touch SwapChan" },
        ],
      },
    ],
  },
  {
    id: "agents",
    label: "For AI agents",
    hub: "/agents",
    paths: ["/agents", "/widget", "/embed", "/earn", "/partners"],
    nav: [
      { href: "/agents#setup", label: "MCP setup" },
      { href: "/agents/playbook", label: "Playbook" },
      { href: "/agents/secure-signing", label: "Secure signing" },
      { href: "/widget", label: "Widget" },
    ],
    groups: [
      {
        id: "agent-setup",
        label: "Set up your agent",
        items: [
          { href: "/agents#setup", label: "MCP setup" },
          { href: "/agents/playbook", label: "Agent playbook" },
          { href: "/agents/secure-signing", label: "Secure signing" },
        ],
      },
      {
        id: "agent-earn",
        label: "Widget & earning",
        items: [
          { href: "/widget", label: "Swap widget" },
          { href: "/embed", label: "Widget preview" },
          { href: "/earn", label: "Earn with the widget" },
          { href: "/partners", label: "Partners" },
        ],
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    hub: "/tools",
    paths: [
      "/tools",
      "/token",
      "/contract",
      "/simulate",
      "/broadcast",
      "/read-chain",
      "/gas",
      "/market",
      "/scanner",
    ],
    nav: [
      { href: "/tools#check-wallet", label: "Check a wallet" },
      { href: "/tools#check-token", label: "Token or contract" },
      { href: "/tools#before-sign", label: "Before you sign" },
      { href: "/tools#market", label: "Market info" },
      { href: "/tools#dev", label: "Developer tools" },
    ],
    groups: [
      {
        id: "check-wallet",
        label: "Check a wallet",
        items: [
          { href: "/find-money", label: "Find forgotten money" },
          { href: "/dashboard", label: "Wallet dashboard" },
          { href: "/wallet", label: "History & PnL" },
          { href: "/airdrops", label: "Airdrop checker" },
          { href: "/rebalance", label: "Portfolio rebalancer" },
        ],
      },
      {
        id: "check-token",
        label: "Check a token or contract",
        items: [
          { href: "/token", label: "Token pools & whales" },
          { href: "/contract", label: "Contract reader" },
          {
            href: "/contract/ethereum/0xdAC17F958D2ee523a2206206994597C13D831ec7",
            label: "Example: USDT contract",
          },
          {
            href: "/contract/ethereum/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            label: "Example: USDC contract",
          },
        ],
      },
      {
        id: "before-sign",
        label: "Before you sign",
        items: [
          { href: "/simulate", label: "Transaction simulator" },
          { href: "/read-chain", label: "Read chain state" },
          { href: "/broadcast", label: "Broadcast a signed tx" },
          { href: "/bridge-status", label: "Bridge status" },
        ],
      },
      {
        id: "market",
        label: "Market info",
        items: [
          { href: "/market", label: "Market today" },
          { href: "/scanner", label: "Token scanner" },
          { href: "/gas", label: "Gas prices" },
        ],
      },
      {
        id: "dev",
        label: "Developer tools",
        items: [
          ...DEV_TOOLS.map((t) => ({ href: `/tools/${t.slug}`, label: t.name })),
          { href: "/tools/contract", label: "Read & Write Contract" },
          { href: "/tools/key-recovery", label: "Key recovery (why not here)" },
        ],
      },
    ],
  },
  {
    id: "chains",
    label: "Chains",
    hub: "/chains",
    paths: ["/chains"],
    nav: [],
    groups: CHAIN_FAMILIES.map((f) => ({
      id: `chains-${f.id}`,
      label: f.label,
      items: CHAIN_PAGES.filter(f.match).map((c) => ({ href: chainHref(c), label: c.title })),
    })),
  },
  {
    id: "how",
    label: "How it works",
    hub: "/how-it-works",
    paths: ["/how-it-works", "/cast", "/terms", "/privacy"],
    nav: [
      { href: "/cast", label: "Meet the cast" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
    groups: [
      {
        id: "cast",
        label: "Meet the cast",
        items: [
          { href: "/cast", label: "The whole cast" },
          ...castOrder.map((k) => ({ href: `/cast/${k}`, label: CAST_LABEL[k] ?? cap(k) })),
        ],
      },
      {
        id: "legal",
        label: "The fine print",
        items: [
          { href: "/terms", label: "Terms" },
          { href: "/privacy", label: "Privacy" },
        ],
      },
    ],
  },
  {
    id: "blocktools",
    label: "blocktools",
    hub: "/blocktools",
    paths: ["/blocktools"],
    nav: [
      { href: "/blocktools/docs", label: "Docs" },
      { href: "/blocktools/recipes", label: "Recipes" },
      { href: "/blocktools/examples", label: "Examples" },
      { href: "/blocktools/binaries", label: "Binaries" },
      { href: "/blocktools/releases", label: "Releases" },
    ],
    groups: [
      {
        id: "bt-start",
        label: "Get started",
        items: [
          { href: "/blocktools/install", label: "Install" },
          { href: "/blocktools/commands", label: "Commands" },
          { href: "/blocktools/binaries", label: "Binaries" },
          { href: "/blocktools/releases", label: "Releases" },
          { href: "/blocktools/mcp", label: "MCP" },
          { href: "/blocktools/faq", label: "FAQ" },
        ],
      },
      {
        id: "bt-docs",
        label: "Docs",
        items: [
          { href: "/blocktools/docs", label: "All docs" },
          ...BT_ITEMS.filter((i) => i.kind === "docs").map((i) => ({
            href: `/blocktools/docs/${i.slug}`,
            label: i.title,
          })),
        ],
      },
      {
        id: "bt-recipes",
        label: "Recipes",
        items: [
          { href: "/blocktools/recipes", label: "All recipes" },
          ...BT_ITEMS.filter((i) => i.kind === "recipes").map((i) => ({
            href: `/blocktools/recipes/${i.slug}`,
            label: i.title,
          })),
        ],
      },
      {
        id: "bt-examples",
        label: "Examples",
        items: [
          { href: "/blocktools/examples", label: "All examples" },
          ...BT_EXAMPLES.map((e) => ({ href: `/blocktools/examples/${e.slug}`, label: e.title })),
        ],
      },
    ],
  },
];

const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

export function sectionFor(p: string): Section | undefined {
  if (p === "/") return SECTIONS[0];
  return SECTIONS.find((s) => s.paths.some((b) => under(p, b)));
}

export function pageLabel(s: Section, p: string): string {
  for (const g of s.groups) for (const it of g.items) if (it.href === p) return it.label;
  const last = p.split("/").filter(Boolean).pop() ?? "";
  return last.length > 40 ? `${last.slice(0, 8)}…${last.slice(-4)}` : cap(last.replace(/-/g, " "));
}

export function relatedFor(s: Section, p: string, n = 4): Link[] {
  const g = s.groups.find((x) => x.items.some((it) => it.href === p)) ?? s.groups[0];
  return (g?.items ?? []).filter((it) => it.href !== p && it.href !== "/").slice(0, n);
}
