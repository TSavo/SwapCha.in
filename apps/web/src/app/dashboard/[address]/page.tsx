import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { DashboardView } from "@/components/tools/Dashboard";

type Props = { params: Promise<{ address: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = decodeURIComponent((await params).address);
  return {
    title: `${a}: wallet dashboard & money finder | SwapChan`,
    description: `Balances, PnL, approvals, airdrops and money found for ${a}.`,
    robots: { index: false, follow: true },
  };
}

export default async function Page({ params }: Props) {
  const a = decodeURIComponent((await params).address);
  return (
    <div className="w-full">
      <nav className="mb-1 text-xs font-bold text-violet-300">
        <Link href="/dashboard" className="hover:text-amber-300">
          Dashboard
        </Link>{" "}
        ·{" "}
        <Link href="/tools" className="hover:text-amber-300">
          DeFi tools
        </Link>
      </nav>
      <h1 className="mb-3 text-2xl font-black break-all">{a}</h1>
      <DashboardView address={a} />
      <section className="mt-10 rounded-3xl border border-fuchsia-400/40 bg-gradient-to-br from-violet-900 to-fuchsia-900/70 p-6">
        <h2 className="text-xl font-black">
          Your agent can do this: “Here's my wallet {a}, find me money.” (find_money)
        </h2>
        <div className="mt-4">
          <AgentCTAs />
        </div>
      </section>
    </div>
  );
}
