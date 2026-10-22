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

/** "How it works": the old first-visit slides, rendered inline (never a modal). */
export function HowItWorks() {
  return (
    <ol className="grid w-full gap-4 md:grid-cols-3">
      {SLIDES.map((s, i) => (
        <li
          key={s.title}
          className="rounded-3xl border-2 border-amber-400/40 bg-violet-950/70 p-5 text-center"
        >
          <div className="text-xs font-bold text-amber-300">STEP {i + 1}</div>
          <div className="mt-2 flex justify-center gap-1">
            {s.who.map((w) => (
              <Character
                key={w}
                who={w}
                size={s.who.length > 2 ? 48 : 96}
                label={s.who.length > 1}
              />
            ))}
          </div>
          <h2 className="mt-3 text-xl font-black text-amber-300">{s.title}</h2>
          <p className="mt-2 text-sm text-violet-100">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}
