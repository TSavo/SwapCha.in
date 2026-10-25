import type { Metadata } from "next";
import { LookupForm } from "@/components/tools/LookupForm";
import { RelatedTools } from "@/components/tools/RelatedTools";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { CHAIN_NAME, chainParam, intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 60;
type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  void chainParam;
  void CHAIN_NAME;
  return {
    title: `${decodeURIComponent(p.address)} wallet history & PnL | SwapChan`,
    description: "Recent swaps and PnL estimate for this wallet.",
    alternates: { canonical: `/wallet/${p.address}` },
    robots: { index: false, follow: true },
  };
}

export default async function Page({ params }: Props) {
  const p = await params;
  const d = await intel(`/onchain/history?address=${p.address}`, 60, 60000);
  return (
    <ToolFrame
      info={tool("wallet_history")}
      path={`/wallet/${p.address}`}
      h1={`Wallet ${decodeURIComponent(p.address)}: swaps & PnL`}
      intro={"Recent swaps (visible history window) and an average-cost PnL estimate."}
      data={d}
      form={
        <LookupForm
          base="/wallet"
          label="Wallet"
          placeholder="0x…, name.eth or Solana address"
          initial={decodeURIComponent(p.address)}
        />
      }
    >
      <RelatedTools ctx="wallet" />
    </ToolFrame>
  );
}
