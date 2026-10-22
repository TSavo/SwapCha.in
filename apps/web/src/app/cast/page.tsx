import { Character } from "@/components/Character";
import { CHARACTERS } from "@/lib/characters";

export const metadata = { title: "The Cast · SwapChan" };

export default function CastPage() {
  return (
    <>
      <h1 className="mt-4 text-4xl font-black text-amber-300">The Cast</h1>
      <p className="mb-8 text-violet-300">One guardian per chain, led by Swap-chan.</p>
      <div className="grid w-full grid-cols-2 gap-4 md:grid-cols-4">
        {Object.values(CHARACTERS).map((c) => (
          <div
            key={c.key}
            className="flex flex-col items-center rounded-3xl border-2 bg-violet-950/70 p-4 text-center"
            style={{ borderColor: `${c.color}88` }}
          >
            <Character who={c.key} size={128} />
            <h2 className="mt-2 text-lg font-black" style={{ color: c.color }}>
              {c.name}
            </h2>
            <p className="text-xs text-violet-300">{c.tagline}</p>
            {c.key !== "swapchan" && c.chainId === null && (
              <span className="mt-2 rounded-full bg-violet-800 px-2 text-[10px] font-bold">
                COMING SOON
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
