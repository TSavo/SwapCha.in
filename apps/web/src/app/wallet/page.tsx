import type { Metadata } from "next";
import Link from "next/link";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { tool } from "@/lib/toolList";

export const metadata: Metadata = {
  title: "Wallet history & PnL checker for any crypto wallet | SwapChan",
  description:
    "See recent swaps and a PnL estimate for any Ethereum, Base, Arbitrum, Optimism or Solana wallet. No sign-up.",
  alternates: { canonical: "/wallet" },
};

export default function Page() {
  return (
    <ToolFrame
      info={tool("wallet_history")}
      path="/wallet"
      h1={"Wallet history & PnL checker"}
      intro={
        "Paste any EVM or Solana wallet (ENS and SNS work) to see recent swaps and an average-cost PnL estimate."
      }
      form={
        <LookupForm base="/wallet" label="Wallet" placeholder="0x…, name.eth or Solana address" />
      }
    >
      <p className="text-sm text-violet-300">
        Example:{" "}
        <Link href="/wallet/vitalik.eth" className="font-bold text-amber-300 underline">
          /wallet/vitalik.eth
        </Link>
      </p>
    </ToolFrame>
  );
}
