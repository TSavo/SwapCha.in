import type { Metadata } from "next";
import Link from "next/link";
import { LookupForm } from "@/components/tools/LookupForm";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { tool } from "@/lib/toolList";

export const metadata: Metadata = {
  title: "Bridge transaction stuck? Free bridge status checker | SwapChan",
  description:
    "Find out where a stuck bridge transfer is: LI.FI, Across, Relay, deBridge and THORChain checked at once, with next steps.",
  alternates: { canonical: "/bridge-status" },
};

export default function Page() {
  return (
    <ToolFrame
      info={tool("bridge_doctor")}
      path="/bridge-status"
      h1={"Bridge doctor: where is my bridge transfer?"}
      intro={
        "Paste the source tx hash. We check LI.FI, Across, Relay, deBridge and THORChain plus the origin receipt, and tell you what to do."
      }
      form={
        <LookupForm
          base="/bridge-status"
          label="Transaction hash"
          placeholder="0x… source transaction hash"
          button="Diagnose"
        />
      }
    >
      <p className="text-sm text-violet-300">
        Example:{" "}
        <Link href="/tools" className="font-bold text-amber-300 underline">
          /tools
        </Link>
      </p>
    </ToolFrame>
  );
}
