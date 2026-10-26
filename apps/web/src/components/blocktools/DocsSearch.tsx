"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SearchDoc } from "@/lib/blocktools.server";

/** Client-side full-text search across the blocktools docs, recipes and examples. */
export function DocsSearch({ docs }: { docs: SearchDoc[] }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("q");
    if (u) setQ(u);
  }, []);
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return docs
      .map((d) => {
        const t = d.title.toLowerCase();
        const x = d.text.toLowerCase();
        if (!words.every((w) => t.includes(w) || x.includes(w))) return null;
        const score = words.reduce(
          (s, w) => s + (t.includes(w) ? 10 : 0) + x.split(w).length - 1,
          0,
        );
        const i = Math.max(0, x.indexOf(words[0] ?? "") - 60);
        return { d, score, snip: `${i ? "…" : ""}${d.text.slice(i, i + 180)}…` };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [q, docs]);
  return (
    <div className="mb-8">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${docs.length} blocktools docs, recipes and examples… (try "keystore", "sweep", "tx-verify")`}
        aria-label="Search blocktools docs"
        className="w-full rounded-full border-2 border-violet-500 bg-violet-950/70 px-5 py-3 text-violet-50 placeholder:text-violet-400 focus:border-amber-300 focus:outline-none"
      />
      {q && (
        <ul className="mt-3 space-y-2" data-testid="bt-search-results">
          {hits.length === 0 && <li className="text-violet-300">No matches.</li>}
          {hits.map((h) => (
            <li key={h.d.href} className="rounded-xl border border-violet-600 bg-violet-900/40 p-3">
              <Link href={h.d.href} className="font-bold text-amber-300 hover:underline">
                {h.d.title}
              </Link>{" "}
              <span className="text-xs text-violet-400">{h.d.kind}</span>
              <p className="mt-1 text-xs text-violet-200">{h.snip}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
