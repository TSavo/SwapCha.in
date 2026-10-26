import { AgentCTAs } from "./AgentCTA";

/** "Use this in your agent" band for the end of any tool page. */
export function AgentCTASection({ tool, prompt }: { tool?: string; prompt?: string }) {
  return (
    <section className="mt-10 w-full rounded-3xl border-2 border-fuchsia-400/40 bg-gradient-to-br from-violet-900 to-fuchsia-900/60 p-6">
      <h2 className="text-2xl font-black">Use this in your agent</h2>
      <p className="mt-1 text-violet-200">
        {tool ? (
          <>
            This page is the{" "}
            <code className="rounded bg-violet-950 px-1.5 py-0.5 text-amber-300">{tool}</code> tool
            in the SwapChan MCP server.
          </>
        ) : (
          <>Everything on this page is a tool in the SwapChan MCP server.</>
        )}{" "}
        SwapChan never holds keys or funds; your agent gets unsigned transactions you sign yourself.
      </p>
      {prompt && (
        <p className="mt-3 rounded-xl border-2 border-violet-600 bg-violet-950 px-4 py-3">
          “{prompt}”
        </p>
      )}
      <div className="mt-4">
        <AgentCTAs />
      </div>
    </section>
  );
}
