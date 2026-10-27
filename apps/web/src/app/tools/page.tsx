import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { PoweredBy } from "@/components/devtools/PoweredBy";
import { SectionHub } from "@/components/SectionHub";
import { DEV_TOOLS } from "@/lib/devTools";
import { TOOLS } from "@/lib/toolList";
import { trendingTokens } from "@/lib/trending";

export const metadata: Metadata = {
  title: "DeFi toolbox: wallet money finder, simulator, PnL, gas | SwapChan",
  description:
    "DeFi tools, no account needed: find forgotten money in any wallet, simulate transactions, check PnL, pools, whales, contracts, airdrops, bridges and gas. Every tool also works in your AI agent.",
  alternates: { canonical: "/tools" },
};

export const revalidate = 600;

export default async function ToolsHub() {
  const tokens = (await trendingTokens()).filter((t) => t.indexable).slice(0, 40);
  const tokenPages = tokens.flatMap((t) => [
    { href: `/token/${t.chain}/${t.address}/pools`, label: `${t.symbol} pools` },
    { href: `/token/${t.chain}/${t.address}/whales`, label: `${t.symbol} whales` },
  ]);
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "DeFi tools",
    itemListElement: [
      ...TOOLS.map((t) => ({ name: t.name, href: t.href })),
      ...DEV_TOOLS.map((t) => ({ name: t.name, href: `/tools/${t.slug}` })),
    ].map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      url: `https://swapchan.com${t.href}`,
    })),
  };
  return (
    <div className="w-full">
      <script type="application/ld+json">{JSON.stringify(ld)}</script>
      <h1 className="text-3xl font-black">DeFi toolbox</h1>
      <p className="mb-6 text-violet-200">
        No sign-up, no paywall, live on-chain data. Paste a wallet, token or tx and get an answer
        that ends in a best-price swap. Every tool is also an MCP tool your AI agent can call.
      </p>
      <SectionHub
        id="tools"
        search
        collapseOver={18}
        extra={[{ id: "trending-tokens", label: "Trending token pages", items: tokenPages }]}
      />
      <section className="mt-10" id="developer-tools">
        <h2 className="text-2xl font-black">Good to know</h2>
        <p className="mb-4 text-violet-200">
          Address validator, converters, xpub derivation, SS58, Solana PDA and chain parameters.
          Public data only: no keys, no seed phrases, nothing stored.
        </p>
        <p className="mt-4 text-sm text-violet-200">
          Address formats and a validator for each chain:{" "}
          <Link href="/chains" className="underline hover:text-amber-300">
            browse chains
          </Link>
          .
        </p>
        <p className="mt-4 text-sm text-violet-200">
          Call any EVM contract like a block explorer&apos;s Contract tab:{" "}
          <Link href="/tools/contract" className="underline hover:text-amber-300">
            Read &amp; Write Contract
          </Link>
          .
        </p>
        <p className="mt-4 text-sm text-violet-200">
          Looking for key derivation or wallet recovery? That never happens on SwapChan:{" "}
          <Link href="/tools/key-recovery" className="underline hover:text-amber-300">
            here is why and where it lives
          </Link>
          .
        </p>
        <p className="mt-4 text-sm text-violet-200">
          These tools run on blocktools, an open source (MIT) command-line toolkit for many chains
          (the chain table lists what each one supports):{" "}
          <Link href="/blocktools" className="underline hover:text-amber-300">
            install it and see every command
          </Link>
          .
        </p>
        <p className="mt-3 text-xs text-violet-400">
          <PoweredBy />
        </p>
      </section>
      <section className="mt-10 rounded-3xl border border-fuchsia-400/40 bg-gradient-to-br from-violet-900 to-fuchsia-900/70 p-6">
        <h2 className="text-2xl font-black">Give your AI agent all of these</h2>
        <p className="mb-4 text-violet-200">
          “Here's my wallet 0x…, find me money.” One MCP server, every tool on this page.
        </p>
        <AgentCTAs />
      </section>
    </div>
  );
}
