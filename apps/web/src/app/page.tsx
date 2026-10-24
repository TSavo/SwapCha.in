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
        "Cross-chain swap and bridge aggregator comparing 0x, CoW, Velora, LI.FI, Across and Relay, plus a free MCP server for AI agents.",
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
          </Link>
        </p>
      </div>
      <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="order-2 lg:order-none">
          <Greeting />
        </div>
        <div className="order-1 w-full max-w-lg lg:order-none">
          <SwapTabs />
        </div>
        <div className="order-3 w-full max-w-lg lg:order-none lg:w-72">
          <LiveRoutes />
        </div>
      </div>
      <AgentSection />
    </>
  );
}
