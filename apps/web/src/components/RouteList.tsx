"use client";

import type { Quote, Token } from "@swapchan/shared";
import { formatAmount, formatEta, formatUsd } from "@/lib/amount";
import { Character } from "./Character";
import { HopAnimation } from "./HopAnimation";

const PROVIDER_NAMES: Record<string, string> = {
  "0x": "0x",
  cow: "CoW Swap",
  velora: "Velora",
  lifi: "LI.FI",
  across: "Across",
  relay: "Relay",
};

export function RouteList({
  quotes,
  best,
  selected,
  onSelect,
  toToken,
  errors,
}: {
  quotes: Quote[];
  best: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  toToken: Token;
  errors: { provider: string; message: string }[];
}) {
  return (
    <div className="space-y-2">
      {quotes.map((q, i) => {
        const isSel = q.id === selected;
        return (
          <button
            type="button"
            key={q.id}
            onClick={() => onSelect(q.id)}
            className={`w-full rounded-2xl border-2 p-3 text-left transition ${isSel ? "border-amber-400 bg-amber-400/10" : "border-violet-700/50 bg-violet-900/40 hover:border-violet-400"}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-black">{PROVIDER_NAMES[q.provider] ?? q.provider}</span>
                {q.id === best && (
                  <span className="rounded-full bg-amber-400 px-2 text-[10px] font-black text-violet-950">
                    BEST ★
                  </span>
                )}
                {i > 0 && <span className="text-[10px] text-violet-400">#{i + 1}</span>}
              </div>
              <div className="text-right">
                <div className="font-black">
                  {formatAmount(q.toAmount, toToken.decimals)} {toToken.symbol}
                </div>
                <div className="text-xs text-violet-300">net {formatUsd(q.netUsd)}</div>
              </div>
            </div>
            <div className="mt-1 flex gap-4 text-xs text-violet-300">
              <span>⛽ gas {formatUsd(q.gasUsd)}</span>
              <span>💸 fees {formatUsd(q.feeUsd)}</span>
              {q.ourFeeVerified ? (
                <span className="text-emerald-300" title="SwapChan fee confirmed by provider">
                  ✓ our fee {formatUsd(q.ourFeeUsd ?? 0)}
                </span>
              ) : (
                <span className="text-amber-300" title="This route pays SwapChan no fee">
                  no SwapChan fee
                </span>
              )}
              <span>⏱ {formatEta(q.etaSeconds)}</span>
              <span>min {formatAmount(q.toAmountMin, toToken.decimals, 4)}</span>
            </div>
            {isSel && <HopAnimation steps={q.steps} />}
          </button>
        );
      })}
      {errors.length > 0 && (
        <details className="text-xs text-violet-400">
          <summary className="flex cursor-pointer items-center gap-1">
            <Character who="swapchan" size={20} mood="sad" /> {errors.length} provider(s) didn't
            answer
          </summary>
          <ul className="mt-1 pl-6">
            {errors.map((e) => (
              <li key={e.provider}>
                {e.provider}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function RoutesLoading({ from, to }: { from: number; to: number }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-sm text-violet-200">
      <HopAnimation
        steps={[
          {
            type: "bridge",
            tool: "",
            fromChainId: from,
            toChainId: to,
            fromToken: "0x0",
            toToken: "0x0",
            fromAmount: "0",
            toAmount: "0",
          },
        ]}
      />
      <span className="animate-pulse">Swap-chan is asking every DEX and bridge for you…</span>
    </div>
  );
}
