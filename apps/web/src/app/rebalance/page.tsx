import type { Metadata } from "next";
import { RebalanceForm } from "@/components/tools/PostForms";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Crypto portfolio rebalancer with live best-price swaps | SwapChan",
  description:
    "Set target weights for any wallet and get a priced swap plan using live best routes across every aggregator and bridge.",
  alternates: { canonical: "/rebalance" },
};

export default async function Page() {
  const m = await intel("/onchain/market", 300);
  return (
    <ToolFrame
      info={tool("rebalance_plan")}
      path="/rebalance"
      h1="Rebalance your portfolio in one plan"
      intro={`Targets in, priced swaps out. Market now: ${typeof m?.read === "string" ? m.read : "live"}`}
      data={m ? { next: m.next } : null}
      form={<RebalanceForm />}
    >
      <span />
    </ToolFrame>
  );
}
