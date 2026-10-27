import type { Metadata } from "next";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { displayAddress } from "@/lib/address";
import { CHAIN_NAME, chainParam, intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 3600;
type Props = { params: Promise<{ chain: string; address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  void chainParam;
  void CHAIN_NAME;
  return {
    title: `Contract ${displayAddress(p.address)} on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain}: owner powers & risks | SwapChan`,
    description: `Is ${p.address} on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain} safe? Verified source, proxy and owner powers (pause, blacklist, mint) explained.`,
    alternates: { canonical: `/contract/${p.chain}/${p.address}` },
  };
}

export default async function Page({ params }: Props) {
  const p = await params;
  const d = await intel(
    `/onchain/contract?chainId=${chainParam(p.chain)}&address=${p.address}`,
    3600,
    25000,
  );
  return (
    <ToolFrame
      info={tool("contract_reader")}
      path={`/contract/${p.chain}/${p.address}`}
      h1={`Contract ${displayAddress(p.address)} on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain}`}
      intro={"Verification, proxy status and what the owner can do, in plain English."}
      data={d}
      form={
        <LookupForm
          base="/contract"
          label="Chain and address"
          placeholder="ethereum 0x…"
          initial={`${p.chain} ${p.address}`}
          button="Read"
        />
      }
    />
  );
}
