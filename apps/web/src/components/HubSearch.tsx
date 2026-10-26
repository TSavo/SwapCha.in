"use client";

import { useState } from "react";

/** Filters every [data-hub-item] on the page by its text. Items stay in the HTML, so crawlers see them. */
export function HubSearch({ placeholder = "Search this section…" }: { placeholder?: string }) {
  const [q, setQ] = useState("");
  const run = (v: string) => {
    setQ(v);
    const t = v.trim().toLowerCase();
    for (const el of document.querySelectorAll<HTMLElement>("[data-hub-item]"))
      el.hidden = !!t && !(el.textContent ?? "").toLowerCase().includes(t);
    for (const d of document.querySelectorAll<HTMLDetailsElement>("[data-hub-group] details"))
      d.open = !!t;
    for (const g of document.querySelectorAll<HTMLElement>("[data-hub-group]"))
      g.hidden = !!t && !g.querySelector("[data-hub-item]:not([hidden])");
  };
  return (
    <input
      type="search"
      value={q}
      onChange={(e) => run(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="mb-4 w-full rounded-full border-2 border-violet-500 bg-violet-950 px-4 py-2 text-sm text-violet-50 placeholder:text-violet-400 focus:border-amber-300 focus:outline-none"
    />
  );
}
