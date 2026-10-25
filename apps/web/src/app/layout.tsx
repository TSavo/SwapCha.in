import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { GaPageView } from "@/components/GaPageView";
import { Providers } from "@/components/Providers";
import { RefCapture } from "@/components/RefCapture";
import { DashboardPrompt } from "@/components/tools/DashboardPrompt";
import { GA_ID } from "@/lib/ga";
import { sanitizeGaUrl } from "@/lib/gaUrl";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://swapchan.com"),
  title: "SwapChan: best-price swaps, now with anime",
  description:
    "Swap-chan compares DEX aggregators and bridges to find your best same-chain or cross-chain route.",
  icons: { icon: "/characters/swapchan.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="sparkles antialiased">
        <Providers>
          <RefCapture />
          <header className="site-chrome mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-1.5 text-lg font-black tracking-tight sm:gap-2 sm:text-2xl"
            >
              <img
                src="/characters/swapchan.png"
                alt=""
                width={40}
                height={40}
                className="h-8 w-8 sm:h-10 sm:w-10"
              />
              <span className="bg-gradient-to-r from-amber-300 to-fuchsia-400 bg-clip-text text-transparent">
                SwapChan
              </span>
            </Link>
            <nav className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm font-bold sm:gap-4">
              <Link href="/" className="hidden hover:text-amber-300 sm:inline">
                Swap
              </Link>
              <Link
                href="/agents"
                aria-label="For AI agents"
                title="For AI agents"
                className="rounded-full bg-fuchsia-500 px-2.5 py-2 text-white shadow hover:bg-fuchsia-400 sm:px-3"
              >
                🤖<span className="hidden sm:inline"> For AI agents</span>
                <span className="sm:hidden"> AI</span>
              </Link>
              <Link href="/scanner" className="hover:text-amber-300">
                Scanner
              </Link>
              <Link href="/cast" className="hidden hover:text-amber-300 sm:inline">
                Cast
              </Link>
              <Link href="/how-it-works" className="hidden hover:text-amber-300 sm:inline">
                How it works
              </Link>
              <ConnectButton />
            </nav>
          </header>
          <main className="mx-auto flex max-w-5xl flex-col items-center px-4 pb-16">
            {children}
            <DashboardPrompt />
          </main>
          <footer className="site-chrome mx-auto flex max-w-5xl flex-wrap justify-center gap-4 p-6 text-xs text-violet-300">
            <Link href="/tools" className="font-bold hover:text-amber-300">
              Free DeFi tools
            </Link>
            <Link href="/dashboard" className="hover:text-amber-300">
              Wallet dashboard
            </Link>
            <Link href="/agents" className="hover:text-amber-300">
              MCP server for AI agents
            </Link>
            <Link href="/agents#rest-api" className="hover:text-amber-300">
              REST API
            </Link>
            <Link href="/how-it-works" className="hover:text-amber-300">
              How it works
            </Link>
            <Link href="/swap" className="hover:text-amber-300">
              Swap routes
            </Link>
            <Link href="/bridge" className="hover:text-amber-300">
              Bridge routes
            </Link>
            <Link href="/cast" className="hover:text-amber-300">
              Cast
            </Link>
            <Link href="/scanner" className="hover:text-amber-300">
              Memecoin scanner
            </Link>
            <Link href="/widget" className="hover:text-amber-300">
              Embed widget
            </Link>
            <Link href="/earn" className="hover:text-amber-300">
              Make money
            </Link>
            <Link href="/partners" className="hover:text-amber-300">
              Partners
            </Link>
            <a href="/llms.txt" className="hover:text-amber-300">
              llms.txt
            </a>
            <Link href="/terms" className="hover:text-amber-300">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-amber-300">
              Privacy
            </Link>
          </footer>
        </Providers>
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <GaPageView />
            <Script id="ga4" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());var __s=(${sanitizeGaUrl.toString()});var __r='';try{var __u=new URL(document.referrer);__r=__u.origin===location.origin?__s(document.referrer):__u.origin;}catch(e){}gtag('set',{page_location:__s(location.href),page_referrer:__r,page_title:'SwapChan '+__s(location.pathname)});gtag('config','${GA_ID}',{send_page_view:false});gtag('event','page_view');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
