import { AgentCTAs } from "./AgentCTA";

/** Full-width homepage band promoting the MCP server. */
export function AgentSection() {
  return (
    <section className="mt-12 flex w-full flex-col items-center gap-6 rounded-3xl border border-fuchsia-400/40 bg-gradient-to-br from-violet-900 to-fuchsia-900/70 p-8 text-center md:flex-row md:text-left">
      <div className="relative shrink-0">
        <img src="/characters/swapchan.png" alt="Swap-chan" width={160} height={160} />
        <span className="absolute -right-2 -bottom-2 text-5xl">💻</span>
      </div>
      <div className="flex flex-col items-center gap-4 md:items-start">
        <h2 className="text-3xl font-black">Your AI agent can swap too~</h2>
        <p className="text-violet-200">
          Give Claude, ChatGPT, Cursor or any MCP agent Swap-chan's best-price routes across every
          aggregator and bridge.
        </p>
        <AgentCTAs />
      </div>
    </section>
  );
}
