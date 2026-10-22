"use client";

import { useEffect, useState } from "react";
import type { CharacterKey } from "@/lib/characters";
import { Character } from "./Character";

const SLIDES: { who: CharacterKey[]; title: string; body: string }[] = [
  {
    who: ["swapchan"],
    title: "Konnichiwa! I'm Swap-chan!",
    body: "I ask every DEX aggregator and bridge at once and show you which route puts the most tokens in your wallet, after gas and fees.",
  },
  {
    who: ["ethereum", "base", "arbitrum", "optimism", "polygon"],
    title: "Meet the chain-chans",
    body: "Each chain has a guardian. When you swap across chains, they pass your tokens hand to hand. Sol-chan is training and will join soon!",
  },
  {
    who: ["swapchan", "solana"],
    title: "Your keys, your coins",
    body: "We never hold your funds. Every transaction is built for you and signed by your own wallet. Ready, senpai?",
  },
];

const KEY = "swapchan:onboarded";

export function Onboarding({ forceOpen = false }: { forceOpen?: boolean }) {
  const [open, setOpen] = useState(forceOpen);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!forceOpen && !localStorage.getItem(KEY)) setOpen(true);
  }, [forceOpen]);
  if (!open) return null;
  const s = SLIDES[i] ?? SLIDES[0];
  if (!s) return null;
  const close = () => {
    localStorage.setItem(KEY, "1");
    setOpen(false);
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal
    >
      <div className="w-full max-w-md rounded-3xl border-2 border-amber-400/60 bg-gradient-to-b from-violet-900 to-fuchsia-950 p-6 text-center shadow-[0_0_60px_rgba(168,85,247,.5)]">
        <div className="flex justify-center gap-1">
          {s.who.map((w) => (
            <Character
              key={w}
              who={w}
              size={s.who.length > 2 ? 64 : 120}
              mood="bounce"
              label={s.who.length > 1}
            />
          ))}
        </div>
        <h2 className="mt-4 text-2xl font-black text-amber-300">{s.title}</h2>
        <p className="mt-2 text-violet-100">{s.body}</p>
        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={close}
            className="text-sm text-violet-300 hover:text-white"
          >
            Skip
          </button>
          <div className="flex gap-1">
            {SLIDES.map((sl, j) => (
              <span
                key={sl.title}
                className={`h-2 w-2 rounded-full ${j === i ? "bg-amber-400" : "bg-violet-600"}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => (i < SLIDES.length - 1 ? setI(i + 1) : close())}
            className="rounded-full bg-amber-400 px-4 py-1.5 font-bold text-violet-950"
          >
            {i < SLIDES.length - 1 ? "Next" : "Let's swap!"}
          </button>
        </div>
      </div>
    </div>
  );
}
