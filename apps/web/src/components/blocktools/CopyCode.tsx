"use client";
import { useState } from "react";

/** A command block with a copy button. */
export function CopyCode({ code, label }: { code: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative rounded-xl border border-violet-500/60 bg-black/50 shadow-[0_0_18px_rgba(139,92,246,0.35)]">
      {label && <div className="px-4 pt-3 text-xs font-bold text-violet-300">{label}</div>}
      <pre className="overflow-x-auto px-4 py-3 pr-20 font-mono text-[13px] leading-relaxed text-amber-200">
        {code}
      </pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="absolute top-2 right-2 rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-black text-violet-950 hover:bg-amber-300"
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
