"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { buildInput, type DevTool, looksSecret } from "@/lib/devTools";
import { track } from "@/lib/ga";

type Res = { ok: boolean; result?: unknown; error_code?: string };

const PLAIN: Record<string, string> = {
  secret_input_refused:
    "That looks like a private key or seed phrase. It was not sent. Use public data only.",
  rate_limited: "Too many runs in a minute. Wait a moment and try again.",
  too_large: "Input is too large.",
};
const plain = (c: string) => PLAIN[c] ?? `Could not compute: ${c.replace(/_/g, " ")}.`;

/** Runs one dev tool. Inputs never go to GA or the URL query; examples share via #fragment. */
export function DevToolForm({
  tool,
  initial,
}: {
  tool: DevTool;
  /** preset mode and values (e.g. the chain on a /chains/<slug> page) */
  initial?: { mode: string; values: Record<string, string> };
}) {
  const [modeId, setModeId] = useState(initial?.mode ?? tool.modes[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>(initial?.values ?? {});
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const mode = tool.modes.find((m) => m.id === modeId) ?? tool.modes[0];

  useEffect(() => {
    const ex = tool.examples[Number(window.location.hash.match(/^#ex(\d+)$/)?.[1] ?? -1)];
    if (ex) {
      setModeId(ex.mode);
      setValues(ex.values);
    }
  }, [tool]);

  if (!mode) return null;

  async function run() {
    if (!mode) return;
    setBusy(true);
    let r: Res;
    if (looksSecret(values)) r = { ok: false, error_code: "secret_input_refused" };
    else {
      try {
        const h = await fetch(`${API_URL}/tools/${mode.fn}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildInput(mode, values)),
        });
        r = (await h.json().catch(() => ({ ok: false, error_code: `http_${h.status}` }))) as Res;
        if (h.status === 429) r = { ok: false, error_code: "rate_limited" };
      } catch {
        r = { ok: false, error_code: "network_error" };
      }
    }
    setRes(r);
    setBusy(false);
    track("tool_run", {
      tool: tool.slug,
      ok: r.ok,
      error_code: r.ok ? "" : String(r.error_code ?? ""),
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-violet-600 bg-violet-950 p-4">
      {tool.modes.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist">
          {tool.modes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === mode.id}
              onClick={() => setModeId(m.id)}
              className={`rounded-full px-3 py-1 text-sm font-bold ${m.id === mode.id ? "bg-amber-400 text-violet-950" : "bg-violet-800 text-violet-100"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {mode.fields.map((f) => {
          const common = {
            id: `f-${f.name}`,
            value: values[f.name] ?? "",
            autoComplete: "off",
            spellCheck: false,
            className:
              "w-full rounded-xl border-2 border-violet-500 bg-violet-900 px-3 py-2 font-mono text-sm text-white",
          };
          const set = (v: string) => setValues((o) => ({ ...o, [f.name]: v }));
          return (
            <label key={f.name} htmlFor={common.id} className="text-sm font-bold text-violet-200">
              {f.label}
              {f.kind === "select" ? (
                <select {...common} onChange={(e) => set(e.target.value)}>
                  {f.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.kind === "block" ? (
                <textarea
                  {...common}
                  rows={6}
                  maxLength={f.max ?? 12000}
                  placeholder={f.placeholder}
                  onChange={(e) => set(e.target.value)}
                />
              ) : f.kind === "lines" ? (
                <textarea
                  {...common}
                  rows={3}
                  maxLength={1200}
                  onChange={(e) => set(e.target.value)}
                />
              ) : (
                <input
                  {...common}
                  type={f.kind === "number" ? "number" : "text"}
                  maxLength={300}
                  placeholder={f.placeholder}
                  onChange={(e) => set(e.target.value)}
                />
              )}
            </label>
          );
        })}
        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl border-2 border-violet-950 bg-amber-400 px-5 py-2 font-black text-violet-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {busy ? "Computing…" : "Run"}
        </button>
      </form>
      {tool.examples.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-violet-300">Try an example:</span>
          {tool.examples.map((ex, i) => (
            <a
              key={ex.label}
              href={`#ex${i}`}
              onClick={() => {
                setModeId(ex.mode);
                setValues(ex.values);
                setRes(null);
              }}
              className="rounded-full border border-violet-500 px-3 py-1 hover:border-amber-300"
            >
              {ex.label}
            </a>
          ))}
        </div>
      )}
      {res && (
        <div data-testid="devtool-result" aria-live="polite">
          {res.ok ? (
            <>
              <pre className="max-h-96 overflow-auto rounded-xl bg-black/40 p-3 text-xs">
                {JSON.stringify(res.result, null, 2)}
              </pre>
              <button
                type="button"
                className="mt-2 text-xs font-bold text-amber-300"
                onClick={() =>
                  void navigator.clipboard?.writeText(JSON.stringify(res.result, null, 2))
                }
              >
                Copy JSON
              </button>
            </>
          ) : (
            <p className="rounded-xl bg-rose-900/60 p-3 text-sm">
              {plain(String(res.error_code ?? "error"))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
