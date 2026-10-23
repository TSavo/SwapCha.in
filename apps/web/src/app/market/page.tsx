import type { Metadata } from "next";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Crypto market today: fear & greed, funding, open interest, stablecoins | SwapChan",
  description:
    "Live crypto market context: Fear & Greed index, perp funding and open interest, stablecoin supply and DeFi TVL. Free, updated every few minutes.",
  alternates: { canonical: "/market" },
};

export default async function MarketPage() {
  const d = await intel("/onchain/market", 300);
  return (
    <ToolFrame
      info={tool("market_context")}
      path="/market"
      h1="Crypto market context, live"
      intro={
        typeof d?.read === "string" ? d.read : "Sentiment, leverage and liquidity in one read."
      }
      data={d}
    />
  );
}
