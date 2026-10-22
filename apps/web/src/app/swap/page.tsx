import type { Metadata } from "next";
import { RouteHub } from "@/components/RouteHub";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Swap routes: cheapest way to swap any token on any chain | SwapChan",
  description: `${ROUTES.length} live swap and bridge routes across Ethereum, Base, Arbitrum, Solana, Bitcoin, Tron and more, compared across every aggregator.`,
  alternates: { canonical: "/swap" },
};

export default function SwapHub() {
  return (
    <div className="w-full">
      <h1 className="mb-2 text-3xl font-black">Cheapest swap routes</h1>
      <p className="mb-6 text-violet-200">
        {ROUTES.length} routes, each with a live quote from 0x, CoW, Velora, LI.FI, Across and
        Relay.
      </p>
      <RouteHub routes={ROUTES} />
    </div>
  );
}
