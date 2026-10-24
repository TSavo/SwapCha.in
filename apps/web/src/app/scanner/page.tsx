"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AgentCTASection } from "@/components/AgentCTASection";
import { Character } from "@/components/Character";
import { API_URL } from "@/lib/api";
import { track } from "@/lib/ga";

type Kind = "new" | "trending" | "movers";
type Win = "m5" | "h1" | "h6" | "h24";
interface Row {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  volumeUsd: Partial<Record<Win, number>>;
  priceChangePct: Partial<Record<Win, number>>;
  ageHours: number | null;
  pairUrl: string | null;
  boosts?: number;
  risk: { level: "low" | "medium" | "high"; flags: string[] };
  swapUrl: string;
}
interface Resp {
  tokens: Row[];
  updatedAt: string;
  disclaimer: string;
}

const TABS: { k: Kind; label: string; blurb: string }[] = [
  { k: "new", label: "🆕 New", blurb: "Freshest pairs first" },
  { k: "trending", label: "🔥 Trending", blurb: "Boosted and high-volume" },
  { k: "movers", label: "🚀 Movers", blurb: "Biggest price swings" },
];
const CHAINS = [
  ["solana", "Solana"],
  ["base", "Base"],
  ["bnb", "BNB"],
  ["eth", "Ethereum"],
  ["arbitrum", "Arbitrum"],
  ["all", "All"],
] as const;
const usd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "–"
    : n >= 1e9
      ? `$${(n / 1e9).toFixed(1)}B`
      : n >= 1e6
        ? `$${(n / 1e6).toFixed(1)}M`
        : n >= 1e3
          ? `$${(n / 1e3).toFixed(1)}k`
          : `$${n.toFixed(0)}`;
const price = (n: number | null) =>
  n === null ? "–" : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`;
const age = (h: number | null) =>
  h === null
    ? "–"
    : h < 1
      ? `${Math.max(1, Math.round(h * 60))}m`
      : h < 48
        ? `${Math.round(h)}h`
        : `${Math.round(h / 24)}d`;
const RISK = {
  low: "bg-emerald-500/20 text-emerald-300 border-emerald-400/50",
  medium: "bg-amber-500/20 text-amber-200 border-amber-400/50",
  high: "bg-rose-500/25 text-rose-200 border-rose-400/60",
};

function Pill({
  on,
  children,
  onClick,
}: {
  on: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border-2 px-3 py-1.5 text-sm font-bold transition ${
        on
          ? "border-amber-300 bg-amber-300 text-violet-950"
          : "border-violet-400/60 bg-violet-900 text-violet-100 hover:border-amber-300"
      }`}
    >
      {children}
    </button>
  );
}

export default function ScannerPage() {
  const [kind, setKind] = useState<Kind>("trending");
  const [chain, setChain] = useState<string>("solana");
  const [minLiq, setMinLiq] = useState(10_000);
  const [maxAge, setMaxAge] = useState<number | "">("");
  const [win, setWin] = useState<Win>("h1");
  useEffect(() => track("scanner_viewed", { kind, chain }), [kind, chain]);
  const q = useQuery({
    queryKey: ["scanner", kind, chain, minLiq, maxAge, win],
    queryFn: async (): Promise<Resp> => {
      const p = new URLSearchParams({
        chain,
        minLiquidityUsd: String(minLiq),
        window: win,
        limit: "50",
        ...(maxAge ? { maxAgeHours: String(maxAge) } : {}),
      });
      const r = await fetch(`${API_URL}/scanner/${kind}?${p}`);
      if (!r.ok) throw new Error(`scanner ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const rows = q.data?.tokens ?? [];
  return (
    <div className="mt-4 w-full">
      <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left">
        <Character who="solana" size={96} mood="cheer" />
        <div>
          <h1 className="text-3xl font-black">Memecoin scanner</h1>
          <p className="text-violet-200">
            New pairs, trending tokens and big movers across Solana, Base, BNB and Ethereum, with a
            risk check on every row. One tap to swap at the best price.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <Pill key={t.k} on={kind === t.k} onClick={() => setKind(t.k)}>
            {t.label}
          </Pill>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {CHAINS.map(([k, label]) => (
          <Pill key={k} on={chain === k} onClick={() => setChain(k)}>
            {label}
          </Pill>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Min liquidity
          <select
            value={minLiq}
            onChange={(e) => setMinLiq(Number(e.target.value))}
            className="rounded-lg border-2 border-violet-400/60 bg-violet-900 px-2 py-1"
          >
            {[0, 5_000, 10_000, 50_000, 250_000].map((v) => (
              <option key={v} value={v}>
                {v ? usd(v) : "Any"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Max age
          <select
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value ? Number(e.target.value) : "")}
            className="rounded-lg border-2 border-violet-400/60 bg-violet-900 px-2 py-1"
          >
            <option value="">Any</option>
            {[1, 6, 24, 72, 168].map((v) => (
              <option key={v} value={v}>
                {age(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Change window
          <select
            value={win}
            onChange={(e) => setWin(e.target.value as Win)}
            className="rounded-lg border-2 border-violet-400/60 bg-violet-900 px-2 py-1"
          >
            {(["m5", "h1", "h6", "h24"] as const).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <span className="text-violet-300">
          {q.isFetching
            ? "Refreshing…"
            : q.data
              ? `Updated ${new Date(q.data.updatedAt).toLocaleTimeString()} · auto every 30s`
              : ""}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border-2 border-violet-500/40 bg-violet-950/80">
        <table className="w-full min-w-[720px] text-sm" data-testid="scanner-table">
          <thead className="text-left text-xs uppercase text-violet-300">
            <tr>
              <th className="p-3">Token</th>
              <th className="p-3 text-right">Price</th>
              <th className="p-3 text-right">{win}</th>
              <th className="p-3 text-right">Liquidity</th>
              <th className="p-3 text-right">Vol 24h</th>
              <th className="p-3 text-right">Age</th>
              <th className="p-3">Risk</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-violet-300">
                  Scanning the chains…
                </td>
              </tr>
            )}
            {q.isError && !rows.length && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-rose-300">
                  Scanner is catching its breath (upstream rate limit). Retrying shortly.
                </td>
              </tr>
            )}
            {!q.isLoading && !q.isError && !rows.length && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-violet-300">
                  Nothing matches those filters right now.
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const ch = t.priceChangePct[win];
              return (
                <tr
                  key={`${t.chain}:${t.address}`}
                  className="border-t border-violet-500/20 hover:bg-violet-900/60"
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {t.imageUrl ? (
                        <img
                          src={t.imageUrl}
                          alt=""
                          width={28}
                          height={28}
                          className="h-7 w-7 rounded-full"
                          loading="lazy"
                        />
                      ) : (
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-700 text-xs">
                          ?
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="font-bold">
                          {t.symbol}{" "}
                          <span className="text-xs font-normal text-violet-300">{t.chain}</span>
                          {t.boosts ? (
                            <span className="ml-1 text-xs text-amber-300">⚡{t.boosts}</span>
                          ) : null}
                        </div>
                        <div
                          className="max-w-44 truncate text-xs text-violet-300"
                          title={t.address}
                        >
                          {t.pairUrl ? (
                            <a
                              href={t.pairUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-amber-300"
                            >
                              {t.name}
                            </a>
                          ) : (
                            t.name
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-right tabular-nums">{price(t.priceUsd)}</td>
                  <td
                    className={`p-3 text-right font-bold tabular-nums ${ch === undefined ? "" : ch >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    {ch === undefined ? "–" : `${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`}
                  </td>
                  <td className="p-3 text-right tabular-nums">{usd(t.liquidityUsd)}</td>
                  <td className="p-3 text-right tabular-nums">{usd(t.volumeUsd.h24)}</td>
                  <td className="p-3 text-right tabular-nums">{age(t.ageHours)}</td>
                  <td className="p-3">
                    <span
                      title={t.risk.flags.join(" · ") || "No flags from quick checks"}
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${RISK[t.risk.level]}`}
                    >
                      {t.risk.level === "low"
                        ? "Low"
                        : t.risk.level === "medium"
                          ? "Medium"
                          : "High"}{" "}
                      risk
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <a
                      href={t.swapUrl.replace("https://swapchan.com", "")}
                      onClick={() =>
                        track("scanner_swap_click", {
                          chain: t.chain,
                          token: t.address,
                          kind,
                          risk: t.risk.level,
                        })
                      }
                      className="rounded-full bg-fuchsia-500 px-4 py-1.5 font-bold text-white shadow hover:bg-fuchsia-400"
                    >
                      Swap
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-violet-300" data-testid="scanner-disclaimer">
        ⚠{" "}
        {q.data?.disclaimer ??
          "Not financial advice. New tokens are extremely risky; risk checks are automated and can miss things."}{" "}
        Data: DexScreener, GeckoTerminal, Jupiter, RugCheck, GoPlus. Agents can use the same scanner
        through our{" "}
        <a href="/agents" className="underline hover:text-amber-300">
          MCP server
        </a>
        .
      </p>
      <AgentCTASection tool="scan_new_tokens" />
    </div>
  );
}
