"use client";

import { useState } from "react";
import { SpeechBubble } from "@/components/Character";
import { API_URL } from "@/lib/agents";

/** Builds an UNSIGNED sweep via the API. Nothing is signed or broadcast here; no keys ever touch this page. */
export function SweepRecover(p: { kind: "utxo" | "fork"; coin: string; from: string; sym: string; title: string }) {
  const [to, setTo] = useState(p.kind === "fork" ? p.from : "");
  const [res, setRes] = useState<Record<string, unknown>>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const build = async () => {
    setBusy(true);
    setErr(undefined);
    setRes(undefined);
    const q =
      p.kind === "utxo"
        ? `utxo-sweep?${new URLSearchParams({ coin: p.coin, from: p.from, to })}`
        : `fork-sweep?${new URLSearchParams({ chain: p.coin, from: p.from, to })}`;
    try {
      const r = await fetch(`${API_URL}/onchain/${q}`);
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(j.error ?? j.message ?? r.status));
      setRes(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unsigned = res ? (p.kind === "utxo" ? String(res.unsignedTx) : JSON.stringify(res.tx, null, 2)) : "";
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="sweep-recover">
      <SpeechBubble who="swapchan">
        Step 1: tell me where YOUR {p.sym} should go. I build the unsigned transaction; you sign it offline in your own
        wallet. Never type a seed or private key into any website, including this one.
      </SpeechBubble>
      <div className="rounded-2xl border-2 border-violet-600 bg-violet-950 p-4 text-sm">
        <p className="text-xs font-bold text-violet-300">Step 1 · build unsigned {p.sym} sweep</p>
        <h1 className="text-xl font-black">{p.title}</h1>
        <p className="mt-2 font-mono text-xs break-all text-violet-300">from {p.from}</p>
        <label className="mt-3 block text-xs font-bold text-violet-300" htmlFor="sweep-to">
          Your {p.sym} destination address
        </label>
        <input
          id="sweep-to"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          className="mt-1 w-full rounded-lg border border-violet-500 bg-violet-900 px-3 py-2 font-mono text-xs"
          placeholder={`${p.sym} address you control`}
        />
        <button
          type="button"
          disabled={!to || busy}
          onClick={build}
          className="mt-3 rounded-lg border-2 border-violet-950 bg-amber-400 px-4 py-2 font-black text-violet-950 disabled:opacity-50"
        >
          {busy ? "Building…" : "Build unsigned transaction"}
        </button>
        {err ? <p className="mt-2 text-rose-300">{err}</p> : null}
      </div>
      {res ? (
        <div className="rounded-2xl border-2 border-emerald-500 bg-violet-950 p-4 text-sm">
          <p className="text-xs font-bold text-emerald-300">Unsigned (not broadcast)</p>
          <textarea readOnly value={unsigned} className="mt-2 h-40 w-full rounded bg-violet-900 p-2 font-mono text-xs" />
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(unsigned)}
            className="mt-2 rounded border border-violet-400 px-3 py-1 text-xs font-bold"
          >
            Copy
          </button>
          <p className="mt-3 text-violet-200">{String(res.signing ?? "")}</p>
          {res.note ? <p className="mt-1 text-amber-300">{String(res.note)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
