"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Bordered input + solid button; navigates to `${base}/${value}` (or a custom builder). */
export function LookupForm({
  base,
  placeholder,
  label,
  button = "Check",
  initial = "",
  suffix = "",
}: {
  base: string;
  placeholder: string;
  label: string;
  button?: string;
  initial?: string;
  suffix?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  return (
    <form
      className="flex w-full flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        const s = v.trim();
        if (s) router.push(`${base}/${s.split(/\s+/).map(encodeURIComponent).join("/")}${suffix}`);
      }}
    >
      <label className="sr-only" htmlFor={`lk-${base}`}>
        {label}
      </label>
      <input
        id={`lk-${base}`}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 rounded-xl border-2 border-violet-400 bg-violet-950 px-4 py-3 font-mono text-sm text-white placeholder:text-violet-400 focus:border-amber-300 focus:ring-4 focus:ring-amber-300/40 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-xl border-2 border-violet-950 bg-amber-400 px-6 py-3 font-black text-violet-950 shadow-[0_3px_0_#2e1065] hover:bg-amber-300 active:translate-y-0.5"
      >
        {button}
      </button>
    </form>
  );
}
