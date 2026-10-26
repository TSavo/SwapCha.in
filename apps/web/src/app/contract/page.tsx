import type { Metadata } from "next";
import Link from "next/link";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { tool } from "@/lib/toolList";

export const metadata: Metadata = {
  title: "Smart contract reader: owner powers, proxy, verification | SwapChan",
  description:
    "Read any EVM contract in plain English: Sourcify/Etherscan verification, proxy implementation, and what the owner can do (pause, blacklist, mint).",
  alternates: { canonical: "/contract" },
};

export default function Page() {
  return (
    <ToolFrame
      info={tool("contract_reader")}
      path="/contract"
      h1={"Smart contract reader"}
      intro={
        "Paste a chain and contract: verified source, proxy and owner powers in plain English."
      }
      form={
        <LookupForm
          base="/contract"
          label="Chain and address"
          placeholder="ethereum 0x…"
          button="Read"
        />
      }
    >
      <p className="text-sm text-violet-300">
        Example:{" "}
        <Link
          href="/contract/ethereum/0xdAC17F958D2ee523a2206206994597C13D831ec7"
          className="font-bold text-amber-300 underline"
        >
          /contract/ethereum/0xdAC17F958D2ee523a2206206994597C13D831ec7
        </Link>
      </p>
    </ToolFrame>
  );
}
