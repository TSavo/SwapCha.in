import type { Metadata } from "next";
import { AgentCTAs } from "@/components/AgentCTA";
import { DashboardHome } from "@/components/tools/Dashboard";

export const metadata: Metadata = {
  title: "Free crypto wallet dashboard: find money, PnL, approvals, airdrops | SwapChan",
  description:
    "Connect or paste any wallet: balances in USD, forgotten claims, idle stablecoins, risky approvals with one-click revoke, airdrops, PnL and activity. Free.",
  alternates: { canonical: "/dashboard" },
};

export default function DashboardPage() {
  return (
    <div className="w-full">
      <h1 className="text-2xl font-black md:text-3xl">Your wallet, and the money hiding in it</h1>
      <p className="mb-4 text-violet-200">
        Balances, PnL, approvals, airdrops and a ranked list of things worth dollars, across EVM,
        Solana and Tron.
      </p>
      <DashboardHome />
      <section className="mt-10 rounded-3xl border border-fuchsia-400/40 bg-gradient-to-br from-violet-900 to-fuchsia-900/70 p-6">
        <h2 className="text-2xl font-black">
          Or ask your AI agent: “Here's my wallet 0x…, find me money.”
        </h2>
        <p className="mb-4 text-violet-200">
          That's the <code className="rounded bg-violet-950 px-1.5 text-amber-300">find_money</code>{" "}
          tool in the free SwapChan MCP server.
        </p>
        <AgentCTAs />
      </section>
    </div>
  );
}
