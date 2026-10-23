import type { Metadata } from "next";
import { SimulateForm } from "@/components/tools/PostForms";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 120;
export const metadata: Metadata = {
  title: "Free transaction simulator: preview balance changes before you sign | SwapChan",
  description:
    "Simulate any Ethereum, Base, Arbitrum, Optimism, Polygon or BNB transaction for free: balance changes, approvals and revert reasons before you sign.",
  alternates: { canonical: "/simulate" },
};

export default async function Page() {
  const gas = await intel("/onchain/gas/history?chain=1", 120);
  return (
    <ToolFrame
      info={tool("simulate_swap")}
      path="/simulate"
      h1="Simulate a transaction before you sign"
      intro={`Paste a transaction and see exactly what moves. Ethereum gas right now: ${typeof gas?.nowBaseFeeGwei === "number" ? `${gas.nowBaseFeeGwei} gwei` : "live"}.`}
      data={gas ? { next: gas.next } : null}
      form={<SimulateForm />}
    >
      <span />
    </ToolFrame>
  );
}
