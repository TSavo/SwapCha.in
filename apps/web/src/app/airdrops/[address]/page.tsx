import type { Metadata } from "next";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { WalletLookup } from "@/components/tools/WalletLookup";
import { CHAIN_NAME, chainParam, intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 300;
type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  void chainParam;
  void CHAIN_NAME;
  return {
    title: `Airdrops & unclaimed rewards: ${decodeURIComponent(p.address)} | SwapChan`,
    description: "Check this wallet for unclaimed airdrops and rewards.",
    alternates: { canonical: `/airdrops/${p.address}` },
    robots: { index: false, follow: true },
  };
}

export default async function Page({ params }: Props) {
  const p = await params;
  const d = await intel(`/onchain/airdrops?address=${p.address}`, 300, 60000);
  return (
    <ToolFrame
      info={tool("airdrop_check")}
      swap={false}
      path={`/airdrops/${p.address}`}
      h1={`Unclaimed airdrops & rewards for ${decodeURIComponent(p.address)}`}
      intro={
        "Merkl rewards on 9 EVM chains, legacy contracts (PoWH3D, Fomo3D, EtherDelta), Solana rent and Tron. Coverage is listed below; anything outside it is not checked."
      }
      data={d}
      form={
        <WalletLookup
          base="/airdrops"
          label="Wallet"
          placeholder="0x…, name.eth, Solana or Tron address"
          current={decodeURIComponent(p.address)}
        />
      }
    />
  );
}
