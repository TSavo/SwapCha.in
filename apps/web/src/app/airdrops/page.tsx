import type { Metadata } from "next";
import Link from "next/link";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { tool } from "@/lib/toolList";

export const metadata: Metadata = {
  title: "Free airdrop checker: unclaimed rewards, legacy contracts, Solana & Tron | SwapChan",
  description:
    "Check any wallet for unclaimed Merkl rewards, forgotten legacy-contract balances (PoWH3D, Fomo3D, EtherDelta), Solana rent and Tron. Free.",
  alternates: { canonical: "/airdrops" },
};

export default function Page() {
  return (
    <ToolFrame
      info={tool("airdrop_check")}
      path="/airdrops"
      h1={"Free airdrop & unclaimed rewards checker"}
      intro={
        "Merkl rewards on 9 EVM chains, legacy Ethereum contracts (PoWH3D, Fomo3D, EtherDelta), Solana and Tron. We say exactly what we cover."
      }
      form={
        <LookupForm
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
