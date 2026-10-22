"use client";

import { useState } from "react";
import { LimitCard } from "./LimitCard";
import { Card, SwapCard, type SwapInitial } from "./SwapCard";

/** Swap / Limit tabs above the card. Limit = CoW limit orders. */
export function SwapTabs({ initial }: { initial?: SwapInitial }) {
  const [tab, setTab] = useState<"swap" | "limit">("swap");
  const tabs = [
    ["swap", "Swap"],
    ["limit", "Limit"],
  ] as const;
  return (
    <div className="flex w-full max-w-lg flex-col gap-2">
      <div role="tablist" aria-label="Order type" className="flex gap-2">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`cursor-pointer rounded-xl border-2 px-5 py-1.5 font-black ${tab === k ? "border-amber-400 bg-amber-400 text-violet-950" : "border-violet-500 bg-violet-950 text-white hover:border-amber-300"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "swap" ? (
        <SwapCard {...(initial ? { initial } : {})} />
      ) : (
        <Card>
          <LimitCard />
        </Card>
      )}
    </div>
  );
}
