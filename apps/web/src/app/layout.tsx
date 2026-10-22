import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { Providers } from "@/components/Providers";
import { RefCapture } from "@/components/RefCapture";
import { GA_ID } from "@/lib/ga";
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
          <header className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-4 sm:p-4">
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
          </main>
          <footer className="mx-auto flex max-w-5xl flex-wrap justify-center gap-4 p-6 text-xs text-violet-300">
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
            <Link href="/partners" className="hover:text-amber-300">
              Partners
            </Link>
            <a href="/llms.txt" className="hover:text-amber-300">
              llms.txt
            </a>
          </footer>
        </Providers>
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
