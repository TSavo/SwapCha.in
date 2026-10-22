"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Character } from "@/components/Character";
import { StatusTracker } from "@/components/StatusTracker";

function Inner() {
  const sp = useSearchParams();
  const txHash = sp.get("txHash");
  const provider = sp.get("provider");
  const from = Number(sp.get("fromChainId"));
  const to = Number(sp.get("toChainId"));
  if (!txHash?.startsWith("0x") || !provider || !from || !to) {
    return (
      <div
        className="flex flex-col items-center gap-2 py-10 text-violet-300"
        data-testid="status-empty"
      >
        <Character who="swapchan" size={120} mood="think" />
        Add ?provider=&amp;txHash=&amp;fromChainId=&amp;toChainId= to track a swap.
      </div>
    );
  }
  return (
    <StatusTracker
      p={{
        provider,
        txHash: txHash as `0x${string}`,
        fromChainId: from,
        toChainId: to,
        mocked: sp.get("mock") === "1",
      }}
    />
  );
}

export default function StatusPage() {
  return (
    <div className="mt-6 w-full max-w-lg rounded-3xl border-2 border-violet-500/40 bg-violet-950/80 p-4">
      <h1 className="text-2xl font-black text-amber-300">Swap tracker</h1>
      <Suspense>
        <Inner />
      </Suspense>
    </div>
  );
}
