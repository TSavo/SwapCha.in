export const dynamic = "force-dynamic";

import { Character } from "@/components/Character";
import { LiveRoutes } from "@/components/LiveRoutes";
import { Onboarding } from "@/components/Onboarding";
import { SwapCard } from "@/components/SwapCard";

export default function Home() {
  return (
    <>
      <Onboarding />
      <div className="mt-4 mb-6 flex items-center gap-4">
        <Character who="swapchan" size={120} mood="idle" />
        <div>
          <h1 className="text-3xl font-black md:text-4xl">Best route, every chain~</h1>
          <p className="text-violet-300">
            Swap-chan checks 0x, CoW, Velora, LI.FI, Across and Relay at once.
          </p>
        </div>
      </div>
      <SwapCard />
      <LiveRoutes />
    </>
  );
}
