"use client";

import Link from "next/link";
import { useState } from "react";
import { CLIENTS, clientPrompt, UNIVERSAL_PROMPT } from "@/lib/agents";
import { track } from "@/lib/ga";

async function copy(text: string, client: string) {
  await navigator.clipboard.writeText(text);
  track("mcp_config_copied", { client });
}

/** The two CTAs: copy the universal agent prompt, or go to per-client setup. */
export function AgentCTAs() {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <button
        type="button"
        onClick={async () => {
          await copy(UNIVERSAL_PROMPT, "universal");
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }}
        className="rounded-full bg-amber-300 px-7 py-4 text-lg font-black text-violet-950 shadow-xl hover:bg-amber-200"
      >
        {done ? "Copied!" : "Copy instructions for your agent"}
      </button>
      <Link
        href="/agents#setup"
        className="rounded-full border-2 border-fuchsia-300 px-6 py-3 font-bold hover:text-amber-300"
      >
        Set this up for my agent
      </Link>
    </div>
  );
}

export function ClientTabs() {
  const [id, setId] = useState(CLIENTS[0]?.id ?? "cursor");
  const [done, setDone] = useState(false);
  const c = CLIENTS.find((x) => x.id === id) ?? CLIENTS[0];
  if (!c) return null;
  return (
    <div className="rounded-2xl border border-violet-500/40 bg-violet-950/70 p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        {CLIENTS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setId(x.id)}
            className={`rounded-full px-4 py-2 text-sm font-bold ${x.id === id ? "bg-fuchsia-500 text-white" : "bg-violet-900 hover:text-amber-300"}`}
          >
            {x.name}
          </button>
        ))}
      </div>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-violet-200">
        <li>Where: {c.path}</li>
        <li>{c.steps}</li>
        <li>Ask your agent to get a quote for 100 USDC Ethereum → Base.</li>
      </ol>
      <pre className="mb-3 overflow-x-auto rounded-lg bg-black/50 p-3 text-xs">{c.config}</pre>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            await copy(clientPrompt(c), c.id);
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          }}
          className="rounded-full bg-fuchsia-500 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-400"
        >
          {done ? "Copied!" : `Copy ${c.name} instructions for your agent`}
        </button>
        {c.deeplink && (
          <a
            href={c.deeplink}
            onClick={() => track("mcp_config_copied", { client: c.id, method: "deeplink" })}
            className="rounded-full border border-violet-400 px-4 py-2 text-sm font-bold hover:text-amber-300"
          >
            Install in {c.name}
          </a>
        )}
      </div>
    </div>
  );
}
