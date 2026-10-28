import type { Metadata } from "next";
import Link from "next/link";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { WalletLookup } from "@/components/tools/WalletLookup";
import { tool } from "@/lib/toolList";

export const metadata: Metadata = {
  title: "Airdrop checker: unclaimed rewards, legacy contracts, Solana & Tron | SwapChan",
  description:
    "Check any wallet for unclaimed Merkl rewards, forgotten legacy-contract balances (PoWH3D, Fomo3D, EtherDelta), Solana rent and Tron. Read-only, no account needed.",
  alternates: { canonical: "/airdrops" },
};

export default function Page() {
  return (
    <ToolFrame
      info={tool("airdrop_check")}
      swap={false}
      path="/airdrops"
      h1={"Airdrop & unclaimed rewards checker"}
      intro={
        "Merkl rewards on 9 EVM chains, legacy Ethereum contracts (PoWH3D, Fomo3D, EtherDelta), Solana and Tron. We say exactly what we cover."
      }
      form={
        <WalletLookup
          base="/airdrops"
          label="Wallet"
          placeholder="0x…, name.eth, Solana or Tron address"
        />
      }
    >
      <p className="text-sm text-violet-300">
        Example:{" "}
        <Link href="/airdrops/vitalik.eth" className="font-bold text-amber-300 underline">
          /airdrops/vitalik.eth
        </Link>
      </p>
    </ToolFrame>
  );
}
