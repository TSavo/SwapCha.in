export const dynamic = "force-dynamic";

import Link from "next/link";
import { AgentSection } from "@/components/AgentSection";
import { Greeting } from "@/components/Greeting";
import { LiveRoutes } from "@/components/LiveRoutes";
import { SwapCard } from "@/components/SwapCard";

export default function Home() {
  return (
    <>
      <div className="mt-1 mb-4 text-center">
        <h1 className="text-2xl font-black md:text-3xl">Best route, every chain~</h1>
        <p className="text-sm text-violet-300">
          0x, CoW, Velora, LI.FI, Across and Relay compared at once ·{" "}
          <Link href="/how-it-works" className="underline hover:text-amber-300">
            How it works
          </Link>
        </p>
      </div>
      <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <Greeting />
        <SwapCard />
        <div className="w-full max-w-lg lg:w-72">
          <LiveRoutes />
        </div>
      </div>
      <AgentSection />
    </>
  );
}
