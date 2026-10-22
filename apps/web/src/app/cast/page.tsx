import type { Metadata } from "next";
import Link from "next/link";
import { BIOS, castHref, castOrder, fullArtSrc } from "@/lib/bios";
import { CHARACTERS } from "@/lib/characters";

export const metadata: Metadata = {
  title: "The Cast · SwapChan",
  description: "Meet Swap-chan and the chain-chans: one anime guardian per blockchain.",
  openGraph: { images: ["/characters/og/cast.png"] },
  twitter: { card: "summary_large_image", images: ["/characters/og/cast.png"] },
};

export default function CastPage() {
  return (
    <>
      <h1 className="mt-4 text-4xl font-black text-amber-300">The Cast</h1>
      <p className="mb-8 text-center text-violet-300">
        One guardian per chain, led by Swap-chan. Tap anyone to read her bio.
      </p>
      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {castOrder.map((key) => {
          const c = CHARACTERS[key];
          const b = BIOS[key];
          return (
            <Link
              key={key}
              href={castHref(key)}
              data-testid={`cast-${key}`}
              className="group flex flex-col items-center rounded-3xl border-2 bg-violet-950/70 p-4 text-center transition hover:-translate-y-1 hover:bg-violet-900/70"
              style={{ borderColor: `${c.color}88` }}
            >
              <img
                src={fullArtSrc(key)}
                alt={c.name}
                width={176}
                height={272}
                loading="lazy"
                className="h-56 w-auto object-contain drop-shadow-[0_0_14px_var(--glow)] transition group-hover:scale-105"
                style={{ ["--glow" as string]: `${c.color}aa` }}
              />
              <h2 className="mt-2 text-lg font-black" style={{ color: c.color }}>
                {c.name}
              </h2>
              <p className="text-xs text-violet-300">{b.facts.chain.replace(/ \(.*\)$/, "")}</p>
              <p className="mt-1 text-xs text-violet-200">{c.tagline}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1">
                {key !== "swapchan" && c.chainId === null && (
                  <span className="rounded-full bg-violet-800 px-2 text-[10px] font-bold">
                    CHAIN COMING SOON
                  </span>
                )}
                {b.art === "coming-soon" && (
                  <span className="rounded-full bg-violet-800 px-2 text-[10px] font-bold">
                    ART COMING SOON
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
