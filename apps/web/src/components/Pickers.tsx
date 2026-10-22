"use client";

import type { Chain, Token } from "@swapchan/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { isAddress } from "viem";
import { api } from "@/lib/api";
import { characterForChain } from "@/lib/characters";
import { Character } from "./Character";

export function ChainPicker({
  chains,
  value,
  onChange,
  label,
}: {
  chains: Chain[];
  value: number;
  onChange: (id: number) => void;
  label: string;
}) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wider text-violet-300">{label}</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {chains.map((c) => {
          const ch = characterForChain(c.id);
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(c.id)}
              className={`flex items-center gap-1 rounded-full border-2 py-0.5 pr-3 pl-0.5 text-xs font-bold transition ${active ? "scale-105 bg-white/10" : "border-transparent opacity-60 hover:opacity-100"}`}
              style={{ borderColor: active ? ch.color : undefined }}
            >
              <Character who={ch.key} size={28} link={false} />
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TokenPicker({
  tokens,
  value,
  onChange,
  chainId,
}: {
  tokens: Token[];
  value: Token | undefined;
  onChange: (t: Token) => void;
  chainId: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = tokens.filter((t) =>
    `${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(q.toLowerCase()),
  );
  const pasted = q.trim();
  const lookup = useQuery({
    queryKey: ["token", chainId, pasted.toLowerCase()],
    queryFn: () => api.token(chainId, pasted),
    enabled: isAddress(pasted, { strict: false }) && filtered.length === 0,
    staleTime: Infinity,
  });
  const custom = lookup.data;
  const unverified = custom && !custom.verified;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-28 items-center justify-between gap-2 rounded-xl bg-violet-800/70 px-3 py-2 font-bold hover:bg-violet-700"
        aria-haspopup="listbox"
      >
        {value?.symbol ?? "Select"} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-violet-500/40 bg-violet-950 p-2 shadow-2xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or paste address"
            className="mb-2 w-full rounded-lg bg-violet-900 px-2 py-1 text-sm outline-none"
          />
          <ul role="listbox" className="max-h-64 overflow-auto">
            {filtered.length === 0 && lookup.isFetching && (
              <li className="p-2 text-sm text-violet-300">Reading token on-chain…</li>
            )}
            {filtered.length === 0 && custom && (
              <li data-testid="custom-token">
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-violet-800"
                  onClick={() => {
                    onChange(custom);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="font-bold">{custom.symbol}</span>{" "}
                  <span className="text-violet-300">
                    {custom.name} · {custom.decimals} decimals
                  </span>
                  {unverified && (
                    <span className="mt-1 block rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-200">
                      ⚠ Unverified token: not on our list. Check the address before you swap.
                    </span>
                  )}
                </button>
              </li>
            )}
            {filtered.length === 0 && !custom && !lookup.isFetching && (
              <li className="flex items-center gap-2 p-2 text-sm text-violet-300">
                <Character who="swapchan" size={36} mood="sad" /> No tokens here, senpai…
              </li>
            )}
            {filtered.map((t) => (
              <li key={`${t.chainId}-${t.address}`}>
                <button
                  type="button"
                  className="flex w-full justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-violet-800"
                  onClick={() => {
                    onChange(t);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="font-bold">{t.symbol}</span>
                  <span className="truncate pl-2 text-violet-300">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
