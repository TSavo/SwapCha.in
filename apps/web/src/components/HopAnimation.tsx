import type { RouteStep } from "@swapchan/shared";
import { characterForChain } from "@/lib/characters";
import { Character } from "./Character";

/** Chain characters passing the token along each hop of the route. */
export function HopAnimation({ steps, active = true }: { steps: RouteStep[]; active?: boolean }) {
  const chainIds = steps.length
    ? [steps[0]?.fromChainId ?? 1, ...steps.map((s) => s.toChainId)].filter(
        (id, i, a) => i === 0 || id !== a[i - 1],
      )
    : [];
  if (chainIds.length === 0) return null;
  const seq = chainIds.length === 1 ? [chainIds[0] ?? 1, chainIds[0] ?? 1] : chainIds;
  return (
    <div className="flex items-center justify-center gap-1 py-2" aria-label="route hops">
      {seq.map((id, i) => {
        const ch = characterForChain(id);
        return (
          <div key={`${id}-${i}`} className="flex items-center gap-1">
            {i > 0 && (
              <div className="relative h-6 w-16 overflow-hidden">
                <div className="absolute top-1/2 h-0.5 w-full bg-gradient-to-r from-amber-300/20 via-amber-300 to-amber-300/20" />
                {active && (
                  <div className="animate-hop absolute top-0.5 h-5 w-5 rounded-full bg-amber-300 text-center text-[10px] leading-5 font-black text-violet-950 shadow-[0_0_10px_#f5b700]">
                    ¥
                  </div>
                )}
              </div>
            )}
            <Character
              who={i === 0 && seq.length === 2 && seq[0] === seq[1] ? "swapchan" : ch.key}
              size={44}
              mood={active ? "run" : "idle"}
            />
          </div>
        );
      })}
    </div>
  );
}
