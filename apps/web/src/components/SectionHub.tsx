import Link from "next/link";
import type { ReactNode } from "react";
import { HubSearch } from "@/components/HubSearch";
import { type Group, SECTIONS } from "@/lib/sections";

/** Grouped directory of every page in a section. `extra` groups come from live data (routes, trending). */
export function SectionHub({
  id,
  extra = [],
  intro,
  search,
  collapseOver = 24,
}: {
  id: string;
  extra?: Group[];
  intro?: ReactNode;
  search?: boolean;
  collapseOver?: number;
}) {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) return null;
  const groups = [...s.groups, ...extra].filter((g) => g.items.length);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <section
      data-testid={`hub-${id}`}
      className="mb-8 rounded-3xl border border-violet-500/50 bg-violet-950/60 p-4 shadow-[0_0_30px_rgba(124,58,237,0.2)] sm:p-5"
    >
      {intro}
      {(search ?? total > 12) && <HubSearch placeholder={`Search ${total} ${s.label} pages…`} />}
      <div className="grid gap-5 md:grid-cols-2">
        {groups.map((g) => {
          const list = (
            <ul className="flex flex-wrap gap-1.5">
              {g.items.map((it) => (
                <li key={it.href} data-hub-item>
                  <Link
                    href={it.href}
                    className="block rounded-full border border-violet-600 bg-violet-900/70 px-3 py-1 text-sm font-bold text-violet-50 hover:border-amber-300 hover:text-amber-300"
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          );
          return (
            <div
              key={g.id}
              id={g.id}
              data-hub-group
              className={g.items.length > 8 ? "md:col-span-2" : ""}
            >
              {g.items.length > collapseOver ? (
                <details>
                  <summary className="mb-2 cursor-pointer text-sm font-extrabold tracking-wide text-amber-300 uppercase">
                    {g.label} ({g.items.length}) ▾
                  </summary>
                  {list}
                </details>
              ) : (
                <>
                  <h2 className="mb-2 text-sm font-extrabold tracking-wide text-amber-300 uppercase">
                    {g.label}
                  </h2>
                  {list}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
