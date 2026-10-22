import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { Providers } from "@/components/Providers";
import { GA_ID } from "@/lib/ga";
import "./globals.css";

export const metadata: Metadata = {
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
          <header className="mx-auto flex max-w-5xl items-center justify-between p-4">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 text-xl font-black tracking-tight sm:text-2xl"
            >
              <img src="/characters/swapchan.png" alt="" width={40} height={40} />
              <span className="bg-gradient-to-r from-amber-300 to-fuchsia-400 bg-clip-text text-transparent">
                SwapChan
              </span>
            </Link>
            <nav className="flex items-center gap-3 whitespace-nowrap sm:gap-4 text-sm font-bold">
              <Link href="/" className="hidden hover:text-amber-300 sm:inline">
                Swap
              </Link>
              <Link href="/agents" className="hover:text-amber-300">
                Developers / MCP
              </Link>
              <Link href="/cast" className="hover:text-amber-300">
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
