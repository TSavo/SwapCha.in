import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AgentCTASection } from "@/components/AgentCTASection";
import { FindMoneyTool } from "@/components/FindMoneyTool";
import { SwapTabs } from "@/components/SwapTabs";

export const metadata: Metadata = {
  title: "Find forgotten crypto money in your wallets (free, read-only) | SwapChan",
  description:
    "Paste one or hundreds of wallet addresses on Ethereum and 20 more EVM chains, Solana, Tron, Bitcoin, 25+ old coins (DOGE, LTC, BCH, DASH, ZEC and more) and XRP, XLM, ADA, DOT, TON. Find unclaimed rewards, old dividends (PoWH3D, Fomo3D), vault shares, dust and risky approvals, then recover and swap to USDC.",
  alternates: { canonical: "/find-money" },
};

export default function FindMoneyHub() {
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-4 flex flex-col items-center gap-3 sm:flex-row sm:items-end">
        <img
          src="/characters/full/swapchan.webp"
          alt="Swap-chan"
          width={832}
          height={1088}
          className="animate-float w-36 shrink-0 drop-shadow-[0_0_30px_rgba(217,70,239,0.55)] sm:w-44"
        />
        <div className="relative mb-6 rounded-2xl border-2 border-amber-400/60 bg-violet-950/90 px-4 py-3 text-violet-100 shadow-[0_0_24px_rgba(217,70,239,0.35)]">
          <b className="text-amber-300">Let&apos;s find your forgotten money~</b> Paste any wallet
          and I&apos;ll dig through every chain. Read-only, I never touch your keys!
        </div>
      </div>
      <h1 className="mb-2 text-3xl font-black">Find money you forgot about</h1>
      <p className="mb-4 text-violet-200">
        One scan checks wallet balances, unclaimed rewards, legacy contracts, vaults, LPs, lending,
        Lido withdrawals, Safes, dust and risky approvals across every chain SwapChan supports. Each
        find comes with an unsigned recovery transaction and a swap to USDC.
      </p>
      <p className="mb-4 text-sm text-violet-300">
        Also checks Bitcoin forks and old coins (BCH, BTG, LTC, DOGE, FTC, DASH, DGB, RVN, VTC, VIA,
        QTUM, MONA, BSV, GRS, PPC, NVC, CLAM, RDD, BLK, Zcash t1, TRC, AUR, XPM, QRK) with an
        unsigned sweep you sign offline in the coin&apos;s own wallet, and balances on XRP, XLM,
        ALGO, ATOM, DOT, TON, ADA and Signum. Free, read-only: SwapChan never signs and never holds
        keys.
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
