export const dynamic = "force-dynamic";

import Link from "next/link";
import { AgentSection } from "@/components/AgentSection";
import { Greeting } from "@/components/Greeting";
import { LiveRoutes } from "@/components/LiveRoutes";
import { SwapTabs } from "@/components/SwapTabs";

export default function Home() {
  return (
    <>
      <div className="mt-0 mb-2 text-center md:mb-3">
        <h1 className="text-xl font-black md:text-3xl">Best route, every chain~</h1>
        <p className="text-sm text-violet-300">
          0x, CoW, Velora, LI.FI, Across and Relay compared at once ·{" "}
          <Link href="/how-it-works" className="underline hover:text-amber-300">
            How it works
          </Link>
        </p>
      </div>
      <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="order-2 lg:order-none">
          <Greeting />
        </div>
        <div className="order-1 w-full max-w-lg lg:order-none">
          <SwapTabs />
        </div>
        <div className="order-3 w-full max-w-lg lg:order-none lg:w-72">
          <LiveRoutes />
        </div>
      </div>
      <AgentSection />
    </>
  );
}
