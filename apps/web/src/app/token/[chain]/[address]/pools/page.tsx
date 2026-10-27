import type { Metadata } from "next";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { displayAddress } from "@/lib/address";
import { CHAIN_NAME, chainParam, intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 300;
type Props = { params: Promise<{ chain: string; address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  void chainParam;
  void CHAIN_NAME;
  return {
    title: `Token pools & liquidity: ${displayAddress(p.address)} on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain} | SwapChan`,
    description: `Liquidity pools for ${p.address} on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain}: DEX, depth, volume. Then swap it at the best price.`,
    alternates: { canonical: `/token/${p.chain}/${p.address}/pools` },
  };
}

export default async function Page({ params }: Props) {
  const p = await params;
  const d = await intel(
    `/onchain/pools?chainId=${chainParam(p.chain)}&token=${p.address}`,
    300,
    25000,
  );
  return (
    <ToolFrame
      info={tool("token_pools")}
      path={`/token/${p.chain}/${p.address}/pools`}
      h1={`Where ${displayAddress(p.address)} trades on ${CHAIN_NAME[chainParam(p.chain)] ?? p.chain}`}
      intro={"Every pool, its DEX and its liquidity, deepest first."}
      data={d}
      form={
        <LookupForm
          base="/token"
          suffix="/pools"
          label="Chain and token"
          placeholder="base 0x…"
          initial={`${p.chain} ${p.address}`}
          button="Find pools"
        />
      }
    />
  );
}
