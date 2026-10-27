"use client";

import {
  type Chain,
  isEvmChain,
  isReceiveOnly,
  nativeOf,
  SOLANA,
  SUPPORTED_CHAINS,
  type Token,
} from "@swapchan/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, formatUnits, isAddress } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { api } from "@/lib/api";
import { characterForChain } from "@/lib/characters";
import { searchTokens } from "@/lib/tokenSearch";
import { Character } from "./Character";

const POPULAR = ["ETH", "USDC", "USDT", "SOL", "BTC", "BNB", "POL", "AVAX", "TRX", "WBTC", "DAI"];

/** Chain chips: solid, bordered, obviously clickable; selected = filled with the chain color. */
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
  /** The sending-chain picker (LTC/DOGE/BCH are pickable: THORChain only). */
  sending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cur = chains.find((c) => c.id === value);
  const curCh = characterForChain(value);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-wider text-violet-200 uppercase">
          {label} chain
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${label} chain: ${cur?.name ?? "choose"}`}
          data-testid="chain-toggle"
          onClick={() => setOpen((o) => !o)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border-2 py-0.5 pr-2 pl-0.5 text-xs font-bold text-white shadow-md hover:brightness-110"
          style={{ borderColor: curCh.color, background: curCh.color }}
        >
          <span className="shrink-0 overflow-hidden rounded-md bg-violet-900">
            <Character who={curCh.key} size={22} link={false} />
          </span>
          <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,.8)]">{cur?.name ?? "Choose"}</span>
          <span aria-hidden className="drop-shadow-[0_1px_1px_rgba(0,0,0,.8)]">
            {open ? "▴" : "▾"}
          </span>
        </button>
      </div>
      <div
        hidden={!open}
        className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4"
        role="radiogroup"
        aria-label={`${label} chain`}
      >
        {chains.map((c) => {
          const ch = characterForChain(c.id);
          const active = c.id === value;
          const ro = isReceiveOnly(c.id);
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={ro ? `${c.name} swaps through THORChain only` : undefined}
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
              className={`flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border-2 py-1 pr-1.5 pl-1 text-left text-[11px] leading-tight font-bold sm:text-xs transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                active
                  ? "text-white shadow-md"
                  : "border-violet-600 bg-violet-950 text-violet-100 hover:border-violet-300 hover:bg-violet-800"
              }`}
              style={active ? { borderColor: ch.color, background: `${ch.color}` } : undefined}
            >
              <span className="shrink-0 overflow-hidden rounded-md bg-violet-900">
                <Character who={ch.key} size={26} link={false} />
              </span>
              <span
                className={`truncate ${active ? "drop-shadow-[0_1px_1px_rgba(0,0,0,.8)]" : ""}`}
              >
                {c.name}
                {ro && (
                  <span className="block text-[9px] font-semibold text-amber-300">
                    THORChain only
                  </span>
                )}
              </span>
              {active && (
                <span
                  aria-hidden
                  className="ml-auto hidden drop-shadow-[0_1px_1px_rgba(0,0,0,.8)] sm:inline"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TokenLogo({ t, size = 28 }: { t: Pick<Token, "symbol" | "logoURI">; size?: number }) {
  const [bad, setBad] = useState(false);
  if (t.logoURI && !bad)
    return (
      <img
        src={t.logoURI}
        alt=""
        width={size}
        height={size}
        onError={() => setBad(true)}
        className="shrink-0 rounded-full bg-white"
        style={{ width: size, height: size }}
      />
    );
  let h = 0;
  for (const ch of t.symbol) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
      style={{ width: size, height: size, background: `hsl(${h} 65% 45%)`, fontSize: size * 0.45 }}
    >
      {(t.symbol.replace(/[^A-Za-z0-9]/g, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Balances for the listed tokens (EVM, connected wallet only). Keyed by lowercase address. */
function useBalances(tokens: Token[], chainId: number, open: boolean) {
  const { address } = useAccount();
  const enabled = open && !!address && isEvmChain(chainId);
  const native = nativeOf(chainId).toLowerCase();
  const erc20s = tokens.filter((t) => t.address.toLowerCase() !== native).slice(0, 40);
  const nat = useBalance({ address, chainId, query: { enabled } });
  const reads = useReadContracts({
    contracts: erc20s.map((t) => ({
      address: t.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address as `0x${string}`],
      chainId,
    })),
    query: { enabled },
  });
  const out = new Map<string, bigint>();
  if (!enabled) return out;
  if (nat.data) out.set(native, nat.data.value);
  erc20s.forEach((t, i) => {
    const r = reads.data?.[i];
    if (r?.status === "success") out.set(t.address.toLowerCase(), r.result as bigint);
  });
  return out;
}

const fmtBal = (v: bigint, d: number) => {
  const n = Number(formatUnits(v, d));
  return n === 0
    ? "0"
    : n < 0.0001
      ? "<0.0001"
      : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

/** Token button + dialog: big search, popular quick-picks, clean rows, obvious paste-address flow. */
export function TokenPicker({
  tokens,
  value,
  onChange,
  chainId,
  exclude,
}: {
  tokens: Token[];
  value: Token | undefined;
  onChange: (t: Token) => void;
  chainId: number;
  /** Hide tokens by address (e.g. native for CoW sells). */
  exclude?: (t: Token) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(
    () => (exclude ? tokens.filter((t) => !exclude(t)) : tokens),
    [tokens, exclude],
  );
  const filtered = useMemo(() => searchTokens(list, q), [list, q]);
  const pasted = q.trim();
  const isPaste = isAddress(pasted, { strict: false }) || pasted.length > 30;
  const lookup = useQuery({
    queryKey: ["token", chainId, chainId === SOLANA ? pasted : pasted.toLowerCase()],
    queryFn: () => api.token(chainId, pasted),
    enabled: open && isPaste && filtered.length === 0,
    staleTime: Infinity,
  });
  const custom = lookup.data;
  const balances = useBalances(list, chainId, open);
  const pinned = POPULAR.flatMap((s) => list.filter((t) => t.symbol === s));
  const popular = [...pinned, ...list.filter((t) => !pinned.includes(t))].slice(0, 8);
  const chainName = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS]?.name ?? "";
  const ch = characterForChain(chainId);
  // Held tokens first only when browsing; when searching, relevance wins.
  const sorted = q.trim()
    ? filtered
    : [...filtered].sort(
        (a, b) =>
          Number((balances.get(b.address.toLowerCase()) ?? 0n) > 0n) -
          Number((balances.get(a.address.toLowerCase()) ?? 0n) > 0n),
      );

  const pick = (t: Token) => {
    onChange(t);
    setOpen(false);
    setQ("");
  };
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-w-32 shrink-0 cursor-pointer items-center justify-between gap-2 rounded-xl border-2 border-violet-300 bg-violet-700 px-2.5 py-2 font-black text-white shadow hover:border-amber-300 hover:bg-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        {value ? (
          <span className="flex items-center gap-2">
            <TokenLogo t={value} size={24} /> {value.symbol}
          </span>
        ) : (
          "Select token"
        )}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Select a token on ${chainName}`}
            className="flex max-h-[88vh] w-full flex-col rounded-t-2xl border-2 border-violet-400 bg-violet-950 shadow-2xl sm:max-w-md sm:rounded-2xl"
          >
            <div className="flex items-center justify-between border-b-2 border-violet-800 p-4">
              <h2 className="text-lg font-black text-white">Select a token</h2>
              <span
                className="flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-xs font-bold text-white"
                style={{ borderColor: ch.color }}
              >
                on {chainName}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="cursor-pointer rounded-lg border-2 border-violet-600 px-2.5 py-1 font-black text-white hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-amber-300"
              >
                ✕
              </button>
            </div>
            <div className="p-4 pb-2">
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const first = sorted[0] ?? custom ?? undefined;
                  if (first) pick(first);
                }}
                placeholder="Search by name or symbol, or paste a token address"
                aria-label="Search tokens or paste an address"
                className="w-full rounded-xl border-2 border-violet-500 bg-white px-3 py-3 text-base font-semibold text-violet-950 placeholder:text-violet-500 focus:border-amber-400 focus:outline-none"
              />
              {!q && popular.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Popular tokens">
                  {popular.map((t) => (
                    <button
                      key={t.address}
                      type="button"
                      onClick={() => pick(t)}
                      className="flex cursor-pointer items-center gap-1.5 rounded-full border-2 border-violet-500 bg-violet-900 py-1 pr-3 pl-1 text-sm font-bold text-white hover:border-amber-300 hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-amber-300"
                    >
                      <TokenLogo t={t} size={22} /> {t.symbol}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-violet-300">
                Not listed? Paste its contract address above and Swap-chan reads it on-chain.
              </p>
            </div>
            <ul role="listbox" aria-label="Tokens" className="flex-1 overflow-auto px-2 pb-3">
              {filtered.length === 0 && lookup.isFetching && (
                <li className="p-3 text-sm text-violet-200">Reading token on-chain…</li>
              )}
              {filtered.length === 0 && custom && (
                <li data-testid="custom-token">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="w-full cursor-pointer rounded-xl border-2 border-amber-400 bg-violet-900 p-3 text-left hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-amber-300"
                    onClick={() => pick(custom)}
                  >
                    <span className="flex items-center gap-3">
                      <TokenLogo t={custom} />
                      <span>
                        <span className="block font-black text-white">{custom.symbol}</span>
                        <span className="text-sm text-violet-200">
                          {custom.name} · {custom.decimals} decimals
                        </span>
                      </span>
                    </span>
                    {!custom.verified && (
                      <span className="mt-2 block rounded-lg bg-amber-400 px-2 py-1 text-xs font-bold text-violet-950">
                        ⚠ Unverified token: not on our list. Check the address before you swap.
                      </span>
                    )}
                  </button>
                </li>
              )}
              {filtered.length === 0 && !custom && !lookup.isFetching && (
                <li className="flex items-center gap-2 p-3 text-sm text-violet-200">
                  <Character who="swapchan" size={36} mood="sad" />
                  {isPaste
                    ? "That address isn't a token on this chain, senpai…"
                    : "No tokens match, senpai…"}
                </li>
              )}
              {sorted.map((t) => {
                const sel = value?.address.toLowerCase() === t.address.toLowerCase();
                const bal = balances.get(t.address.toLowerCase());
                return (
                  <li key={`${t.chainId}-${t.address}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={sel}
                      onClick={() => pick(t)}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left hover:border-violet-400 hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-amber-300 ${sel ? "border-amber-400 bg-violet-800" : "border-transparent"}`}
                    >
                      <TokenLogo t={t} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-black text-white">{t.symbol}</span>
                          <span
                            className="rounded px-1.5 text-[10px] font-bold text-white"
                            style={{ background: ch.color }}
                          >
                            {chainName}
                          </span>
                        </span>
                        <span className="block truncate text-sm text-violet-200">{t.name}</span>
                      </span>
                      {bal !== undefined && (
                        <span className="text-right text-sm font-bold text-white tabular-nums">
                          {fmtBal(bal, t.decimals)}
                        </span>
                      )}
                      {sel && (
                        <span aria-hidden className="text-amber-300">
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
