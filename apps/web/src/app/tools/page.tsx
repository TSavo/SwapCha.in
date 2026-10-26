import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { PoweredBy } from "@/components/devtools/PoweredBy";
import { DEV_TOOLS } from "@/lib/devTools";
import { TOOLS } from "@/lib/toolList";

export const metadata: Metadata = {
  title: "The ultimate free DeFi toolbox: wallet money finder, simulator, PnL, gas | SwapChan",
  description:
    "Free DeFi tools with no sign-up: find forgotten money in any wallet, simulate transactions, check PnL, pools, whales, contracts, airdrops, bridges and gas. Every tool also works in your AI agent.",
  alternates: { canonical: "/tools" },
};

export default function ToolsHub() {
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Free DeFi tools",
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
      <h1 className="text-3xl font-black">The ultimate free DeFi toolbox</h1>
      <p className="mb-6 text-violet-200">
        No sign-up, no paywall, live on-chain data. Paste a wallet, token or tx and get an answer
        that ends in a best-price swap. Every tool is also an MCP tool your AI agent can call.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="block h-full rounded-2xl border-2 border-violet-600 bg-violet-950 p-4 hover:border-amber-300"
            >
              <span className="text-2xl">{t.emoji}</span>
              <h2 className="text-lg font-black">{t.name}</h2>
              <p className="text-sm text-violet-200">{t.blurb}</p>
              <p className="mt-2 text-xs text-violet-400">
                MCP: <code>{t.mcp}</code>
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <section className="mt-10" id="developer-tools">
        <h2 className="text-2xl font-black">Developer &amp; chain tools</h2>
        <p className="mb-4 text-violet-200">
          Address validator, converters, xpub derivation, SS58, Solana PDA and chain parameters.
          Public data only: no keys, no seed phrases, nothing stored.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {DEV_TOOLS.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/tools/${t.slug}`}
                className="block h-full rounded-2xl border-2 border-violet-600 bg-violet-950 p-4 hover:border-amber-300"
              >
                <span className="text-2xl">{t.emoji}</span>
                <h3 className="text-lg font-black">{t.h1}</h3>
                <p className="text-sm text-violet-200">{t.description}</p>
                <p className="mt-2 text-xs text-violet-400">
                  MCP: <code>{t.mcp}</code>
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-violet-200">
          Address formats and a validator for each chain:{" "}
          <Link href="/chains" className="underline hover:text-amber-300">
            browse chains
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
