"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Character } from "./Character";

const KEY = "swapchan:greeted";

/** Small, dismissible Swap-chan hello beside the swap box. Never blocks the page. */
export function Greeting() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (localStorage.getItem(KEY)) setOpen(false);
  }, []);
  if (!open) return null;
  return (
    <aside
      data-testid="greeting"
      className="flex items-end gap-2 lg:w-60 lg:flex-col lg:items-center"
      aria-label="Swap-chan says hi"
    >
      <Character who="swapchan" size={88} mood="idle" />
      <div className="relative rounded-2xl border-2 border-amber-400/50 bg-violet-950/90 px-4 py-3 pr-8 text-sm text-violet-100">
        <button
          type="button"
          aria-label="Dismiss"
          className="absolute top-1 right-2 text-violet-300 hover:text-white"
          onClick={() => {
            localStorage.setItem(KEY, "1");
            setOpen(false);
          }}
        >
          ×
        </button>
        <b className="text-amber-300">Konnichiwa!</b> I already asked every aggregator and bridge
        for 100 USDC Ethereum → Base. Connect your wallet and swap~{" "}
        <Link href="/how-it-works" className="underline hover:text-amber-300">
          How it works
        </Link>
      </div>
    </aside>
  );
}
