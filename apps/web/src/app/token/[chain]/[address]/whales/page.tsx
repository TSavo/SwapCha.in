import type { Metadata } from "next";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { CHAIN_NAME, chainParam, intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 300;
type Props = { params: Promise<{ chain: string; address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  void chainParam;
  void CHAIN_NAME;
  return {
    title: `Whale watch: ${p.address.slice(0, 10)}… on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain} | SwapChan`,
    description: `Are whales buying or selling ${p.address} on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain}? Large transfers, live.`,
    alternates: { canonical: `/token/${p.chain}/${p.address}/whales` },
  };
}

export default async function Page({ params }: Props) {
  const p = await params;
  const d = await intel(
    `/onchain/whales?chainId=${chainParam(p.chain)}&token=${p.address}`,
    300,
    60000,
  );
  return (
    <ToolFrame
      info={tool("whale_watch")}
      path={`/token/${p.chain}/${p.address}/whales`}
      h1={`Whale watch: ${p.address.slice(0, 10)}… on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain}`}
      intro={"Large recent transfers and what the biggest wallets are doing."}
      data={d}
      form={
        <LookupForm
          base="/token"
          suffix="/whales"
          label="Chain and token"
          placeholder="base 0x…"
          initial={`${p.chain} ${p.address}`}
          button="Watch"
        />
      }
    />
  );
}
