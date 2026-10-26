"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSays } from "@/lib/says";
import { Character } from "./Character";

const KEY = "swapchan:greeted";

/** Swap-chan beside the swap box: reacts to whatever the swap box is doing. Dismissible, never modal. */
export function Greeting({ heroArt = false }: { heroArt?: boolean } = {}) {
  const [open, setOpen] = useState(true);
  const says = useSays();
  useEffect(() => {
    if (localStorage.getItem(KEY)) setOpen(false);
  }, []);
  if (!open) return null;
  return (
    <aside
      data-testid="greeting"
      className="flex items-end gap-2 lg:w-60 lg:flex-col lg:items-center"
      aria-label="Swap-chan says"
      aria-live="polite"
    >
      <span className={heroArt ? "lg:hidden" : undefined}>
        <Character who="swapchan" size={88} mood={says?.mood ?? "idle"} />
      </span>
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
        <span data-testid="greeting-text">
          {says?.text ?? (
            <>
              <b className="text-amber-300">Konnichiwa!</b> Pick a pair and I&apos;ll ask every
              aggregator and bridge at once~
            </>
          )}
        </span>
        {says?.warn && (
          <span className="mt-2 block rounded bg-amber-400/15 px-2 py-1 text-xs text-amber-200">
            ⚠ {says.warn}
          </span>
        )}{" "}
        <Link href="/how-it-works" className="mt-1 block text-xs underline hover:text-amber-300">
          How it works
        </Link>
      </div>
    </aside>
  );
}
