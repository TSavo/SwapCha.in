import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { Providers } from "@/components/Providers";
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
            <Link href="/" className="flex items-center gap-2 text-2xl font-black tracking-tight">
              <img src="/characters/swapchan.png" alt="" width={40} height={40} />
              <span className="bg-gradient-to-r from-amber-300 to-fuchsia-400 bg-clip-text text-transparent">
                SwapChan
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm font-bold">
              <Link href="/" className="hover:text-amber-300">
                Swap
              </Link>
              <Link href="/cast" className="hover:text-amber-300">
                Cast
              </Link>
              <ConnectButton />
            </nav>
          </header>
          <main className="mx-auto flex max-w-5xl flex-col items-center px-4 pb-16">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
