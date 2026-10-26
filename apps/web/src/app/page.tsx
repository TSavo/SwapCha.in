export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { AgentSection } from "@/components/AgentSection";
import { Greeting } from "@/components/Greeting";
import { LiveRoutes } from "@/components/LiveRoutes";
import { SwapTabs } from "@/components/SwapTabs";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "https://swapchan.com/" },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "SwapChan",
      url: "https://swapchan.com/",
    },
    {
      "@type": "WebApplication",
      name: "SwapChan",
      url: "https://swapchan.com/",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      description:
        "Cross-chain swap and bridge aggregator comparing 0x, CoW, Velora, LI.FI, Across and Relay, a free find-money wallet scan (21 EVM chains, Solana, Tron, Bitcoin, 25+ old coins, XRP, XLM, ADA, DOT, TON and more), plus a free MCP server for AI agents.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <div className="mt-0 mb-2 text-center md:mb-3">
        <h1 className="text-xl font-black md:text-3xl">Best route, every chain~</h1>
        <p className="text-sm text-violet-300">
          0x, CoW, Velora, LI.FI, Across and Relay compared at once ·{" "}
          <Link href="/how-it-works" className="underline hover:text-amber-300">
            How it works
          </Link>{" "}
          ·{" "}
          <Link href="/find-money" className="underline hover:text-amber-300">
            Find forgotten money: EVM, Solana, Tron, Bitcoin, DOGE, LTC, DASH, ZEC and 20+ old coins
          </Link>
        </p>
      </div>
      <img
        src="/characters/full/swapchan.webp"
        alt="Swap-chan"
        width={832}
        height={1088}
        className="animate-float -mb-2 w-36 drop-shadow-[0_0_24px_rgba(217,70,239,0.55)] lg:hidden"
      />
      <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="order-2 flex flex-col items-center lg:order-none lg:w-64">
          <img
            src="/characters/full/swapchan.webp"
            alt="Swap-chan"
            width={832}
            height={1088}
            className="animate-float hidden w-64 drop-shadow-[0_0_30px_rgba(217,70,239,0.55)] lg:block"
          />
          <Greeting heroArt />
        </div>
        <div className="order-1 w-full max-w-lg lg:order-none">
          <SwapTabs />
        </div>
        <div className="order-3 w-full max-w-lg lg:order-none lg:w-72">
          <LiveRoutes />
        </div>
      </div>
      <p className="mt-6 text-center text-sm text-violet-300">
        Psst~ I can also{" "}
        <Link href="/find-money" className="font-bold text-amber-300 underline">
          find forgotten money
        </Link>
        , it&apos;s in the menu ✨
      </p>
      <AgentSection />
    </>
  );
}
