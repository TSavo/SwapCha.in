import { CATALOG, PRINCIPLES, WORKFLOWS } from "@swapchan/shared";
import type { Metadata } from "next";
import { AgentCTAs } from "@/components/AgentCTA";
import { SpeechBubble } from "@/components/Character";

export const metadata: Metadata = {
  title: "SwapChan agent playbook: find money, recover, verify, sign, swap | SwapChan",
  description:
    "How an AI agent uses every SwapChan tool together: find money across many wallets, confirm with read_chain, recover keys locally, verify every transaction, get human sign-off, broadcast and swap. Non-custodial.",
  alternates: { canonical: "/agents/playbook" },
};

export default function Page() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 text-white">
      <h1 className="text-4xl font-black">The agent playbook</h1>
      <SpeechBubble who="swapchan">
        Paste your addresses, grab a coffee, and your agent comes back with &quot;I found $X for
        you&quot; plus every step to get it. You approve every transaction yourself.
      </SpeechBubble>
      <section className="rounded-2xl border-2 border-emerald-400 bg-emerald-950 p-5">
        <h2 className="text-2xl font-black">Principles</h2>
        <ul className="list-disc space-y-1 pl-6">
          {PRINCIPLES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
      {Object.entries(WORKFLOWS).map(([id, w]) => (
        <section
          key={id}
          id={id}
          className="rounded-2xl border-2 border-violet-500 bg-violet-950 p-5"
        >
          <h2 className="text-2xl font-black">{w.title}</h2>
          <p className="opacity-80">{w.when}</p>
          <ol className="mt-3 list-decimal space-y-1 pl-6">
            {w.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {w.tips && (
            <ul className="mt-3 list-disc pl-6 text-sm opacity-80">
              {w.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm">
            MCP: <code>swapchan_playbook {`{"workflow":"${id}"}`}</code>
          </p>
        </section>
      ))}
      <section>
        <h2 className="text-2xl font-black">Every tool, and when to use it</h2>
        <ul className="mt-3 space-y-1">
          {CATALOG.map((c) => (
            <li key={c.tool}>
              <code>{c.tool}</code> <span className="opacity-60">({c.group})</span>: {c.when}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl border-2 border-fuchsia-400 bg-violet-950 p-6">
        <h2 className="text-2xl font-black">Use this in your agent</h2>
        <p>
          Add the SwapChan MCP server; it hands this playbook to your agent automatically (server
          instructions and the <code>swapchan_playbook</code> tool). Then just say: &quot;Here are
          my addresses, find me money.&quot;
        </p>
        <AgentCTAs />
      </section>
    </main>
  );
}
