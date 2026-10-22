"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { type EmbedConfig, emit, parseEmbedConfig, setEmbed } from "@/lib/embed";
import { track } from "@/lib/ga";
import { SwapCard } from "./SwapCard";

// Light theme: remap the violet palette the card is built from (Tailwind v4 color vars).
const LIGHT: Record<string, string> = {
  "--color-violet-950": "#ffffff",
  "--color-violet-900": "#f5f3ff",
  "--color-violet-800": "#ede9fe",
  "--color-violet-700": "#ddd6fe",
  "--color-violet-500": "#a78bfa",
  "--color-violet-300": "#6d28d9",
  "--color-violet-200": "#4c1d95",
  "--color-violet-100": "#2e1065",
  "--color-white": "#1e1033",
};

function themeVars(c: EmbedConfig): CSSProperties {
  const v: Record<string, string> = c.theme === "light" ? { ...LIGHT } : {};
  if (c.accent) {
    v["--color-amber-400"] = c.accent;
    v["--color-amber-300"] = c.accent;
    v["--color-fuchsia-500"] = c.accent;
  }
  // Inherited text (e.g. the amount input) must follow the theme too.
  v.color = c.theme === "light" ? "#1e1033" : "#f5f3ff";
  return v as CSSProperties;
}

export function EmbedWidget() {
  const [cfg, setCfg] = useState<EmbedConfig | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = parseEmbedConfig(new URLSearchParams(window.location.search));
    setEmbed(c);
    setCfg(c);
    document.documentElement.dataset.embed = "1";
    track("widget_loaded", {
      partner: c.partner ?? "none",
      host: document.referrer ? new URL(document.referrer).hostname : "direct",
      theme: c.theme,
      lock_to: c.lockTo,
    });
    emit("ready");
  }, []);

  // Tell the host our height so widget.js can size the iframe (no inner scrollbars).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let last = 0;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.scrollHeight);
      if (h !== last) emit("resize", { height: (last = h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cfg]);

  if (!cfg) return <div data-embed-root className="fixed inset-0 z-[100]" />;
  return (
    <div
      data-embed-root
      className={`fixed inset-0 z-[100] overflow-auto ${cfg.chan ? "" : "embed-nochan"}`}
      style={themeVars(cfg)}
    >
      <div ref={root} className="flex flex-col items-center gap-1 p-2">
        <SwapCard embed={{ lockTo: cfg.lockTo, compact: cfg.compact }} />
        <a
          href={`https://swapchan.com/?utm_source=widget&utm_medium=embed${cfg.partner ? `&utm_campaign=${cfg.partner}` : ""}`}
          target="_blank"
          rel="noopener"
          className="flex items-center gap-1 text-[11px] text-violet-300 hover:text-amber-300"
        >
          {cfg.chan && <img src="/characters/swapchan.png" alt="" width={16} height={16} />}
          Powered by SwapChan
        </a>
      </div>
    </div>
  );
}
