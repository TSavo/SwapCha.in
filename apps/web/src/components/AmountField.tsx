"use client";

import { type ReactNode, useEffect, useRef } from "react";

/** Primary editable amount box: solid, bordered, focus ring; click anywhere focuses. */
export function AmountField({
  label,
  value,
  onChange,
  ariaLabel,
  invalid,
  autoFocus,
  right,
  footer,
  size = "lg",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  invalid?: boolean;
  autoFocus?: boolean;
  right?: ReactNode;
  footer?: ReactNode;
  size?: "lg" | "md";
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus || typeof window === "undefined") return;
    if (window.matchMedia("(pointer: fine) and (min-width: 768px)").matches)
      ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <div
      data-testid="amount-field"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button,a,select,[role=dialog]")) ref.current?.focus();
      }}
      className={`mt-2 cursor-text rounded-xl border-2 bg-white px-3 py-2 shadow-sm transition focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-400/40 ${invalid ? "border-rose-500" : "border-violet-400 hover:border-violet-300"}`}
    >
      <div className="text-[11px] font-bold tracking-wider text-violet-700 uppercase">{label}</div>
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          aria-label={ariaLabel}
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full min-w-0 cursor-text bg-transparent font-black caret-violet-700 outline-none placeholder:text-violet-300 ${size === "lg" ? "text-3xl" : "text-2xl"} ${invalid ? "text-rose-600" : "text-violet-950"}`}
        />
        {right}
      </div>
      {footer}
    </div>
  );
}

/** Read-only output: greyed, borderless so the pay field stands out. */
export function AmountReadout({ label, value, right }: { label: string; value: string; right?: ReactNode }) {
  return (
    <div data-testid="amount-readout" className="mt-2 rounded-xl bg-violet-950/60 px-3 py-2">
      <div className="text-[11px] font-bold tracking-wider text-violet-400 uppercase">{label}</div>
      <div className="flex items-center gap-2">
        <div aria-readonly="true" className="w-full min-w-0 truncate text-3xl font-black text-violet-300 select-all">
          {value}
        </div>
        {right}
      </div>
    </div>
  );
}

export function BalanceRow({
  text,
  onPct,
}: {
  text: string;
  onPct: (pct: 50 | 100) => void;
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-violet-600">
      <span>Balance: {text}</span>
      <span className="flex gap-1">
        {([50, 100] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPct(p)}
            className="cursor-pointer rounded-md border-2 border-violet-500 bg-violet-100 px-2 py-0.5 font-bold text-violet-800 hover:border-amber-400"
          >
            {p === 50 ? "HALF" : "MAX"}
          </button>
        ))}
      </span>
    </div>
  );
}
