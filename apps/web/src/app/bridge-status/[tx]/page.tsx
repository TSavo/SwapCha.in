import type { Metadata } from "next";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { CHAIN_NAME, chainParam, intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 30;
type Props = { params: Promise<{ tx: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  void chainParam;
  void CHAIN_NAME;
  return {
    title: `Bridge status ${p.tx.slice(0, 12)}… | SwapChan`,
    description: "Where is my bridge transfer? Diagnosis across every major bridge.",
    alternates: { canonical: `/bridge-status/${p.tx}` },
    robots: { index: false, follow: true },
  };
}

export default async function Page({ params }: Props) {
  const p = await params;
  const d = await intel(`/onchain/bridge?tx=${p.tx}`, 30, 60000);
  return (
    <ToolFrame
      info={tool("bridge_doctor")}
      path={`/bridge-status/${p.tx}`}
      h1={"Bridge status & diagnosis"}
      intro={`Tx ${p.tx.slice(0, 18)}… checked across LI.FI, Across, Relay, deBridge and THORChain.`}
      data={d}
      form={
        <LookupForm
          base="/bridge-status"
          label="Transaction hash"
          placeholder="0x… source transaction hash"
          initial={p.tx}
          button="Diagnose"
        />
      }
    />
  );
}
