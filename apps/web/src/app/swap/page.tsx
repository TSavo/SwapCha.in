import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTASection } from "@/components/AgentCTASection";
import { RouteHub } from "@/components/RouteHub";
import { ROUTES } from "@/lib/routes";
import { CHAIN_LABEL, trendingTokens, trendSlugs } from "@/lib/trending";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Swap routes: cheapest way to swap any token on any chain | SwapChan",
  description: `${ROUTES.length} live swap and bridge routes across Ethereum, Base, Arbitrum, Solana, Bitcoin, Tron and more, compared across every aggregator.`,
  alternates: { canonical: "/swap" },
};

export default async function SwapHub() {
  const trending = (await trendingTokens()).filter((t) => t.indexable).slice(0, 30);
  return (
    <div className="w-full">
      <h1 className="mb-2 text-3xl font-black">Cheapest swap routes</h1>
      <p className="mb-6 text-violet-200">
        {ROUTES.length} routes, each with a live quote from 0x, CoW, Velora, LI.FI, Across and
        Relay.
      </p>
      {trending.length > 0 && (
        <section className="mb-8" data-testid="trending-swaps">
          <h2 className="mb-2 text-xl font-black">Trending swaps</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {trending.map((t) => (
              <li key={t.key}>
                <Link
                  href={`/swap/${trendSlugs(t)[0]}`}
                  className="block rounded-xl border-2 border-violet-700 bg-violet-950 px-3 py-2 text-sm font-bold hover:border-amber-300"
                >
                  Buy {t.symbol} on {CHAIN_LABEL[t.chain]}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <RouteHub routes={ROUTES} />
      <AgentCTASection
        tool="get_quote"
        prompt="Find me the cheapest route to swap 1 ETH to USDC on Base."
      />
    </div>
  );
}
