import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Memecoin scanner: new, trending and fast-moving tokens | SwapChan",
  description:
    "Live scanner for new Solana, Base, BNB and Ethereum memecoins: fresh pairs, trending tokens and big movers with automated risk checks and one-click best-price swaps.",
  alternates: { canonical: "/scanner" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
