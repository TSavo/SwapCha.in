import type { Metadata } from "next";
import { RouteHub } from "@/components/RouteHub";
import { isBridge, ROUTES } from "@/lib/routes";

const BRIDGES = ROUTES.filter(isBridge);
export const metadata: Metadata = {
  title: "Bridge routes: cheapest cross-chain bridges compared | SwapChan",
  description: `${BRIDGES.length} cross-chain routes between EVM chains, Solana, Bitcoin and Tron, priced live across LI.FI, Across and Relay.`,
  alternates: { canonical: "/bridge" },
};

export default function BridgeHub() {
  return (
    <div className="w-full">
      <h1 className="mb-2 text-3xl font-black">Cheapest bridge routes</h1>
      <p className="mb-6 text-violet-200">
        {BRIDGES.length} cross-chain routes, each with a live best-price quote.
      </p>
      <RouteHub routes={BRIDGES} />
    </div>
  );
}
