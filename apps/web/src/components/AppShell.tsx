"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { pageLabel, relatedFor, sectionFor } from "@/lib/sections";

type Item = {
  href: string;
  label: string;
  icon: ReactNode;
  sec?: string;
  match?: (p: string) => boolean;
};

const Face = () => (
  <img
    src="/characters/swapchan.png"
    alt=""
    width={22}
    height={22}
    className="h-[22px] w-[22px] rounded-full bg-violet-950 object-cover object-top"
  />
);

const MAIN: Item[] = [
  { href: "/", label: "Swap", icon: "🔁", sec: "swap" },
  { href: "/find-money", label: "Find money", icon: <Face />, sec: "find" },
  // Label only: the route stays /dashboard.
  { href: "/dashboard", label: "My wallet", icon: "👛", sec: "wallet" },
  { href: "/recover", label: "Recover", icon: "🔑", sec: "recover" },
];
const EXPLORE: Item[] = [
  { href: "/tools", label: "Tools", icon: "🧰", sec: "tools" },
  { href: "/chains", label: "Chains", icon: "⛓️", sec: "chains" },
  { href: "/how-it-works", label: "How it works", icon: "✨", sec: "how" },
];
const AGENTS: Item = {
  href: "/agents",
  label: "AI agents",
  icon: "🤖",
  sec: "agents",
};
const BT: Item = { href: "/blocktools", label: "blocktools CLI", icon: "🛠️", sec: "blocktools" };
const DEV: Item[] = [
  { href: "/agents#setup", label: "MCP setup", icon: "🔌", match: () => false },
  { href: "/widget", label: "Widget", icon: "🧩" },
];

function isActive(it: Item, p: string) {
  if (it.match) return it.match(p);
  if (it.sec) return sectionFor(p)?.id === it.sec;
  return p === it.href || p.startsWith(`${it.href}/`);
}

function NavItem({
  it,
  p,
  small,
  onNav,
}: {
  it: Item;
  p: string;
  small?: boolean;
  onNav: () => void;
}) {
  const active = isActive(it, p);
  const subs = active && !small && it.sec ? (sectionFor(p)?.nav ?? []) : [];
  return (
    <>
      <Link
        href={it.href}
        onClick={onNav}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2.5 rounded-xl px-2.5 font-bold transition ${
          small ? "py-1.5 text-[13px] text-violet-300" : "py-2 text-[15px] text-violet-50"
        } ${
          active
            ? "bg-amber-400 text-violet-950 shadow-[0_0_18px_rgba(251,191,36,0.45)]"
            : "hover:bg-violet-500/30 hover:text-amber-300"
        }`}
      >
        <span className="flex w-[22px] justify-center">{it.icon}</span>
        {it.label}
      </Link>
      {subs.length > 0 && (
        <ul
          data-testid="nav-subitems"
          className="mb-1 ml-[22px] border-l-2 border-amber-300/50 pl-2"
        >
          {subs.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                onClick={onNav}
                aria-current={p === c.href ? "page" : undefined}
                className={`block rounded-lg px-2 py-1 text-[13px] font-bold ${
                  p === c.href ? "text-amber-300" : "text-violet-300 hover:text-amber-300"
                }`}
              >
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Sidebar({ p, onNav }: { p: string; onNav: () => void }) {
  const devOpen = false;
  return (
    <div className="flex h-full flex-col gap-1 px-3 py-4">
      <Link
        href="/"
        onClick={onNav}
        className="mb-3 flex items-center gap-2 px-1.5 text-2xl font-black tracking-tight"
      >
        <img src="/characters/swapchan.png" alt="" width={40} height={40} className="h-10 w-10" />
        <span className="bg-gradient-to-r from-amber-300 to-fuchsia-400 bg-clip-text text-transparent">
          SwapChan
        </span>
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {MAIN.map((it) => (
          <NavItem key={it.href} it={it} p={p} onNav={onNav} />
        ))}
        <Link
          href={AGENTS.href}
          onClick={onNav}
          aria-current={isActive(AGENTS, p) ? "page" : undefined}
          className={`mt-2 flex items-center gap-2.5 rounded-full px-3 py-2 text-[15px] font-bold text-white shadow transition ${
            isActive(AGENTS, p)
              ? "bg-fuchsia-400 shadow-[0_0_18px_rgba(217,70,239,0.6)] ring-2 ring-amber-300"
              : "bg-fuchsia-500 hover:bg-fuchsia-400"
          }`}
        >
          <span className="flex w-[22px] justify-center">🤖</span>For AI agents
        </Link>
        {isActive(AGENTS, p) && (
          <ul
            data-testid="nav-subitems"
            className="mt-1 ml-[22px] border-l-2 border-fuchsia-300/60 pl-2"
          >
            {(sectionFor(p)?.nav ?? []).map((c) => (
              <li key={c.href}>
                <Link
                  href={c.href}
                  onClick={onNav}
                  className={`block rounded-lg px-2 py-1 text-[13px] font-bold ${
                    p === c.href ? "text-amber-300" : "text-violet-300 hover:text-amber-300"
                  }`}
                >
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mx-2.5 mt-4 mb-1 text-[11px] font-extrabold tracking-widest text-violet-400 uppercase">
          Explore
        </div>
        {EXPLORE.map((it) => (
          <NavItem key={it.href} it={it} p={p} onNav={onNav} />
        ))}
        <details open={devOpen} className="mt-4">
          <summary className="mx-2.5 mb-1 cursor-pointer text-[11px] font-extrabold tracking-widest text-violet-400 uppercase hover:text-amber-300">
            Developers
          </summary>
          {DEV.map((it) => (
            <NavItem key={it.label} it={it} p={p} small onNav={onNav} />
          ))}
        </details>
        <div className="mx-2.5 mt-4 mb-1 text-[11px] font-extrabold tracking-widest text-violet-400 uppercase">
          Command line
        </div>
        <NavItem it={BT} p={p} onNav={onNav} />
      </nav>
      <div className="mt-auto border-t border-violet-500/30 px-2.5 pt-3 text-[11px] text-violet-400">
        <div className="mt-1 opacity-80">
          <Link href="/terms" onClick={onNav} className="hover:text-amber-300">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" onClick={onNav} className="hover:text-amber-300">
            Privacy
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Section › Page breadcrumb plus a short Related row, on every child page (not on hubs). */
function Crumbs({ p }: { p: string }) {
  const s = sectionFor(p);
  if (!s || p === "/" || p === s.hub) return null;
  const rel = relatedFor(s, p);
  return (
    <div className="site-chrome mx-3 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs font-bold sm:mx-6 md:text-sm">
      <nav aria-label="Breadcrumb" data-testid="breadcrumb" className="text-violet-300">
        <Link href={s.hub} className="hover:text-amber-300">
          {s.label}
        </Link>
        <span className="mx-1.5 text-violet-500">›</span>
        <span className="text-violet-50">{pageLabel(s, p)}</span>
      </nav>
      {rel.length > 0 && (
        <div
          data-testid="related"
          className="flex flex-wrap items-center gap-1.5 text-[11px] md:text-xs"
        >
          <span className="text-violet-400">Related:</span>
          {rel.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="rounded-full border border-violet-600 px-2 py-0.5 text-violet-200 hover:border-amber-300 hover:text-amber-300"
            >
              {r.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** One navigation place: left sidebar on desktop, drawer + bottom tabs on mobile. */
export function AppShell({ connect, children }: { connect: ReactNode; children: ReactNode }) {
  const p = usePathname() || "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [p]);
  const close = () => setOpen(false);
  return (
    <div className="flex min-h-screen">
      <aside className="site-chrome sticky top-0 hidden h-screen w-[232px] shrink-0 border-r border-violet-500/35 bg-[rgba(30,10,55,0.75)] shadow-[4px_0_30px_rgba(124,58,237,0.15)] md:block">
        <Sidebar p={p} onNav={close} />
      </aside>
      {open && (
        <div className="site-chrome fixed inset-0 z-50 md:hidden" data-testid="drawer">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-[rgba(10,0,20,0.6)]"
            onClick={close}
          />
          <aside className="relative h-full w-[270px] border-r border-violet-500/35 bg-[rgb(30,10,55)]">
            <Sidebar p={p} onNav={close} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="site-chrome flex items-center justify-end gap-2 px-3 py-2 sm:px-6 sm:py-3">
          <button
            type="button"
            aria-label="Open menu"
            className="mr-1 text-2xl md:hidden"
            onClick={() => setOpen(true)}
          >
            ☰
          </button>
          <Link href="/" className="mr-auto flex items-center gap-1.5 text-lg font-black md:hidden">
            <img
              src="/characters/swapchan.png"
              alt=""
              width={30}
              height={30}
              className="h-[30px] w-[30px]"
            />
            <span className="bg-gradient-to-r from-amber-300 to-fuchsia-400 bg-clip-text text-transparent">
              SwapChan
            </span>
          </Link>
          <span className="hidden rounded-full border border-violet-500 bg-violet-900/60 px-3 py-1 text-xs font-bold text-violet-200 sm:inline">
            <b className="text-amber-300">Free</b> · never holds your keys ·{" "}
            <b className="text-amber-300">your wallet signs</b>
          </span>
          {connect}
        </div>
        <div className="site-chrome mx-3 -mt-1 mb-1 rounded-full border border-violet-500/60 bg-violet-900/50 px-3 py-1 text-center text-[11px] font-bold text-violet-200 sm:hidden">
          <b className="text-amber-300">Free</b> · never holds your keys ·{" "}
          <b className="text-amber-300">your wallet signs</b>
        </div>
        <Crumbs p={p} />
        <div className="flex-1 pb-20 md:pb-6">{children}</div>
      </div>
      <nav
        aria-label="Quick"
        className="site-chrome fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-violet-600 bg-[rgba(30,10,55,0.95)] pt-1.5 pb-2.5 md:hidden"
      >
        {[...MAIN, { ...AGENTS, label: "AI agents" }].map((it) => {
          const a = isActive(it, p);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={a ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 text-[11px] font-bold ${a ? "text-amber-300" : "text-violet-300"}`}
            >
              <span className="text-xl leading-6">{it.icon}</span>
              {it.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
