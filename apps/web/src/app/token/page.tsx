import type { Metadata } from "next";
import Link from "next/link";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { tool } from "@/lib/toolList";

export const metadata: Metadata = {
  title: "Token liquidity pools & whale watch for any token | SwapChan",
  description:
    "Find every liquidity pool for a token, its DEX and depth, and watch large transfers. Free, live.",
  alternates: { canonical: "/token" },
};

export default function Page() {
  return (
    <ToolFrame
      info={tool("token_pools")}
      path="/token"
      h1={"Token pools, liquidity & whale watch"}
      intro={"Paste a chain and token address to see every pool and what the whales are doing."}
      form={
        <LookupForm
          base="/token"
          suffix="/pools"
          label="Chain and token"
          placeholder="base 0x…"
          button="Find pools"
        />
      }
    >
      <p className="text-sm text-violet-300">
        Example:{" "}
        <Link
          href="/token/base/0x532f27101965dd16442E59d40670FaF5eBB142E4/pools"
          className="font-bold text-amber-300 underline"
        >
          /token/base/0x532f27101965dd16442E59d40670FaF5eBB142E4/pools
        </Link>
      </p>
    </ToolFrame>
  );
}
