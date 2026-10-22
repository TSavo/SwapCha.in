"use client";

import { SUPPORTED_CHAINS } from "@swapchan/shared";
import { useEffect, useState } from "react";
import { embedParams, iframeSnippet, type SnippetOptions, scriptSnippet } from "@/lib/embed";

const CHAINS = Object.entries(SUPPORTED_CHAINS).map(([id, c]) => ({
  id: Number(id),
  name: c.name,
}));

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="rounded-lg bg-amber-400 px-3 py-1 text-xs font-black text-violet-950 hover:bg-amber-300"
    >
      {done ? "Copied!" : "Copy"}
    </button>
  );
}

const field =
  "w-full rounded-lg border-2 border-violet-700 bg-violet-900 px-2 py-1.5 text-sm outline-none focus:border-amber-400";

export function WidgetConfigurator() {
  const [o, setO] = useState<SnippetOptions>({ theme: "dark", chan: true });
  const [kind, setKind] = useState<"script" | "iframe">("script");
  const set = (p: Partial<SnippetOptions>) => setO((x) => ({ ...x, ...p }));
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("partner");
    if (p) set({ partner: p });
  }, []);
  // Debounce the preview so typing doesn't reload the iframe on every key.
  const [preview, setPreview] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setPreview(`/embed?${embedParams(o)}`), 400);
    return () => clearTimeout(id);
  }, [o]);
  const snippet = kind === "script" ? scriptSnippet(o) : iframeSnippet(o);
  const chainSel = (key: "fromChain" | "toChain") => (
    <select
      className={field}
      value={o[key] ?? ""}
      onChange={(e) => set({ [key]: e.target.value ? Number(e.target.value) : undefined })}
    >
      <option value="">Default</option>
      {CHAINS.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
  const check = (key: "chan" | "compact" | "lockTo", label: string, dflt = false) => (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={o[key] ?? dflt}
        onChange={(e) => set({ [key]: e.target.checked })}
        className="h-4 w-4 accent-amber-400"
      />
      {label}
    </label>
  );
  return (
    <div className="mt-6 flex flex-col gap-6 lg:flex-row">
      <div className="flex-1 space-y-3 rounded-2xl border-2 border-violet-700 bg-violet-950 p-4">
        <label className="block text-sm font-bold">
          Partner id
          <input
            className={field}
            placeholder="from /partners (optional)"
            value={o.partner ?? ""}
            onChange={(e) => set({ partner: e.target.value.trim() || undefined })}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-bold">From chain{chainSel("fromChain")}</label>
          <label className="text-sm font-bold">To chain{chainSel("toChain")}</label>
          <label className="text-sm font-bold">
            From token
            <input
              className={field}
              placeholder="address / mint"
              value={o.fromToken ?? ""}
              onChange={(e) => set({ fromToken: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="text-sm font-bold">
            To token
            <input
              className={field}
              placeholder="address / mint"
              value={o.toToken ?? ""}
              onChange={(e) => set({ toToken: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="text-sm font-bold">
            Amount
            <input
              className={field}
              inputMode="decimal"
              placeholder="e.g. 100"
              value={o.amount ?? ""}
              onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") || undefined })}
            />
          </label>
          <label className="text-sm font-bold">
            Theme
            <select
              className={field}
              value={o.theme}
              onChange={(e) => set({ theme: e.target.value as "dark" | "light" })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className="text-sm font-bold">
            Accent
            <div className="flex gap-2">
              <input
                type="color"
                value={o.accent ?? "#fbbf24"}
                onChange={(e) => set({ accent: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded bg-transparent"
              />
              {o.accent && (
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => set({ accent: undefined })}
                >
                  reset
                </button>
              )}
            </div>
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          {check("chan", "Show Swap-chan", true)}
          {check("compact", "Compact")}
          {check("lockTo", "Lock destination token")}
        </div>
        <div className="flex gap-2 pt-2">
          {(["script", "iframe"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-xl border-2 px-3 py-1 text-sm font-black ${kind === k ? "border-amber-400 bg-amber-400 text-violet-950" : "border-violet-500"}`}
            >
              {k === "script" ? "Script tag" : "Plain iframe"}
            </button>
          ))}
        </div>
        <div className="rounded-lg bg-black/50 p-3">
          <pre
            className="overflow-x-auto whitespace-pre-wrap break-all text-xs"
            data-testid="snippet"
          >
            {snippet}
          </pre>
          <div className="mt-2 flex justify-end">
            <Copy text={snippet} />
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center">
        <p className="mb-1 text-xs text-violet-300">Live preview</p>
        {preview && (
          <iframe
            key={preview}
            src={preview}
            title="SwapChan widget preview"
            width={420}
            height={o.compact ? 560 : 720}
            className="max-w-full rounded-3xl"
            style={{ border: 0 }}
          />
        )}
      </div>
    </div>
  );
}
