import type { Metadata } from "next";
import Link from "next/link";
import { PoweredBy } from "@/components/devtools/PoweredBy";
import { CHAIN_FAMILIES, CHAIN_PAGES, chainHref } from "@/lib/chainPages";

const TITLE = `Crypto Address Formats & Validators for ${CHAIN_PAGES.length} Chains | SwapChan`;
const DESC = `Address format, prefixes, decimals and a free validator for ${CHAIN_PAGES.length} blockchains, from Bitcoin and its forks to Ethereum, Solana, Polkadot and Monero. Public data only.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/chains" },
  openGraph: { title: TITLE, description: DESC, url: "/chains" },
};

export default function ChainsIndex() {
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Crypto address validators by chain",
      itemListElement: CHAIN_PAGES.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.h1,
        url: `https://swapchan.com${chainHref(c)}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Free tools",
          item: "https://swapchan.com/tools",
        },
        { "@type": "ListItem", position: 2, name: "Chains", item: "https://swapchan.com/chains" },
      ],
    },
  ];
  return (
    <div className="w-full" data-testid="chains-index">
      <script type="application/ld+json">{JSON.stringify(ld)}</script>
      <nav className="mb-1 text-xs font-bold text-violet-300 md:text-sm">
        <Link href="/tools" className="hover:text-amber-300">
          Free tools
        </Link>
        {" · Chains"}
      </nav>
      <h1 className="text-3xl font-black">Address formats for {CHAIN_PAGES.length} chains</h1>
      <p className="mb-6 text-violet-200">
        Pick a chain to see how its addresses are built (version bytes, bech32 prefix, checksum,
        decimals), check one live, and see which other chains share its format. Public data only: no
        keys, no seed phrases, nothing stored. Not sure which chain an address is on? Use the{" "}
        <Link href="/tools/validate-address" className="underline hover:text-amber-300">
          chain detector
        </Link>
        .
      </p>
      {CHAIN_FAMILIES.map((f) => {
        const list = CHAIN_PAGES.filter(f.match);
        return (
          <section key={f.id} id={f.id} className="mb-8">
            <h2 className="mb-3 text-2xl font-black">
              {f.label} ({list.length})
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {list.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={chainHref(c)}
                    className="block h-full rounded-xl border-2 border-violet-600 bg-violet-950 p-3 hover:border-amber-300"
                  >
                    <span className="font-black">{c.title}</span>{" "}
                    <span className="text-xs text-violet-400">{c.ticker}</span>
                    <p className="text-xs text-violet-200">{c.formats[0]?.label}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="mt-3 text-xs text-violet-400">
        <PoweredBy />
      </p>
    </div>
  );
}
