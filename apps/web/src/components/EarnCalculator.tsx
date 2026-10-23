"use client";
import { useState } from "react";

const PARTNER_RATE = 0.0005; // 5 bp = half of SwapChan's 10 bp fee
const MAX = 10_000_000;
const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 100 ? 2 : 0,
  });

export function EarnCalculator() {
  const [vol, setVol] = useState(100_000);
  const monthly = vol * PARTNER_RATE;
  return (
    <div className="mt-6 rounded-2xl border border-violet-700 bg-violet-950/60 p-6">
      <h2 className="text-2xl font-black">Earnings calculator</h2>
      <label htmlFor="earn-vol" className="mt-4 block text-sm font-bold text-violet-200">
        Monthly swap volume you refer (USD)
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="range"
          min={0}
          max={MAX}
          step={10_000}
          value={Math.min(vol, MAX)}
          onChange={(e) => setVol(Number(e.target.value))}
          className="w-full accent-amber-400"
          aria-label="Monthly referred swap volume slider"
        />
        <input
          id="earn-vol"
          type="number"
          min={0}
          inputMode="numeric"
          value={vol}
          onChange={(e) => setVol(Math.max(0, Number(e.target.value) || 0))}
          className="w-full rounded-lg border border-violet-500 bg-black/30 px-3 py-2 font-mono sm:w-44"
        />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-black/30 p-4">
          <div className="text-xs font-bold uppercase text-violet-300">Per month</div>
          <div data-testid="earn-monthly" className="text-3xl font-black text-amber-300">
            {usd(monthly)}
          </div>
        </div>
        <div className="rounded-xl bg-black/30 p-4">
          <div className="text-xs font-bold uppercase text-violet-300">Per year</div>
          <div data-testid="earn-yearly" className="text-3xl font-black text-amber-300">
            {usd(monthly * 12)}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-violet-300">
        Estimate only: volume × 0.05% (5 bp, half of SwapChan&apos;s 0.1% fee). Actual earnings
        depend on which swaps carry our fee; see the FAQ below.
      </p>
    </div>
  );
}
