import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTASection } from "@/components/AgentCTASection";
import { P3dCheck } from "@/components/P3dCheck";
import { SwapTabs } from "@/components/SwapTabs";

export const metadata: Metadata = {
  title: "PoWH3D (P3D) dividend checker: withdraw old P3D dividends (free) | SwapChan",
  description:
    "Check any Ethereum address for unwithdrawn PoWH3D (P3D) dividends and tokens. Get the unsigned withdraw() or exit() transaction, sign it in your own wallet, then swap the ETH to USDC.",
  alternates: { canonical: "/find-money/powh3d" },
};

export default function Powh3dPage() {
  return (
    <div className="w-full max-w-3xl">
      <h1 className="mb-2 text-3xl font-black">PoWH3D (P3D) dividend checker</h1>
      <p className="mb-4 text-violet-200">
        PoWH3D (contract <code>0xB3775fB8…efBe</code>, 2018) still pays dividends to every P3D
        holder, and many were never withdrawn. Paste an address: we read <code>dividendsOf</code>,{" "}
        <code>balanceOf</code> and the sell price on-chain, then build the unsigned{" "}
        <code>withdraw()</code> (dividends only) or <code>exit()</code> (sell P3D and withdraw)
        transaction. Your wallet signs it; SwapChan never holds keys or funds.
      </p>
      <P3dCheck />
      <section className="mt-6 text-sm text-violet-200">
        <h2 className="mb-1 text-xl font-black text-white">Before you sign</h2>
        <ul className="list-disc pl-5">
          <li>
            exit() pays PoWH3D&apos;s 10% exit fee to other holders; withdraw() keeps your P3D.
          </li>
          <li>It is a legacy, unaudited contract. Check the transaction preview in your wallet.</li>
          <li>
            The same scan also checks Fomo3D vaults, EtherDelta and Liquity surplus. For everything
            else, use the{" "}
            <Link href="/find-money" className="underline hover:text-amber-300">
              full find-money scan
            </Link>
            .
          </li>
        </ul>
      </section>
      <AgentCTASection
        tool="find_money"
        prompt="Check my wallet for PoWH3D dividends and withdraw them"
      />
      <section className="mt-8">
        <h2 className="mb-2 text-xl font-black">Swap the ETH</h2>
        <SwapTabs />
      </section>
    </div>
  );
}
