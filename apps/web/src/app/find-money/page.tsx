import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AgentCTASection } from "@/components/AgentCTASection";
import { FindMoneyTool } from "@/components/FindMoneyTool";
import { SwapTabs } from "@/components/SwapTabs";

export const metadata: Metadata = {
  title: "Find forgotten crypto money in your wallets (free, read-only) | SwapChan",
  description:
    "Paste one or hundreds of wallet addresses on Ethereum, Base, Arbitrum, Solana, Tron and Bitcoin. Find unclaimed rewards, old dividends (PoWH3D, Fomo3D), vault shares, dust and risky approvals, then recover and swap to USDC.",
  alternates: { canonical: "/find-money" },
};

export default function FindMoneyHub() {
  return (
    <div className="w-full max-w-3xl">
      <h1 className="mb-2 text-3xl font-black">Find money you forgot about</h1>
      <p className="mb-4 text-violet-200">
        One scan checks wallet balances, unclaimed rewards, legacy contracts, vaults, LPs, lending,
        Lido withdrawals, Safes, dust and risky approvals across every chain SwapChan supports. Each
        find comes with an unsigned recovery transaction and a swap to USDC.
      </p>
      <Suspense>
        <FindMoneyTool />
      </Suspense>
      <section className="mt-8">
        <h2 className="mb-2 text-xl font-black">Specific checks</h2>
        <ul className="list-disc pl-5">
          <li>
            <Link href="/find-money/powh3d" className="underline hover:text-amber-300">
              PoWH3D (P3D) dividends and tokens
            </Link>
          </li>
          <li>
            <Link href="/find-money/guide" className="underline hover:text-amber-300">
              Where crypto money gets stuck: the full guide
            </Link>
          </li>
          <li>
            <Link href="/recover/seed-phrase" className="underline hover:text-amber-300">
              Only have a seed phrase? Derive every address offline, then paste them here
            </Link>
          </li>
        </ul>
      </section>
      <AgentCTASection tool="find_money" prompt="Find any money I forgot about in my wallets" />
      <section className="mt-8">
        <h2 className="mb-2 text-xl font-black">Swap what you found</h2>
        <SwapTabs />
      </section>
    </div>
  );
}
