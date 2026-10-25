"use client";

import { safeIcon } from "@/lib/injectedWallets";
import { closeTronPicker, connectTron, useTronState } from "@/lib/tron";

/** Tron wallet chooser. Renders nothing until a page calls useTron().open(). */
export function TronPicker() {
  const s = useTronState();
  if (!s.picking) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a Tron wallet"
      data-testid="tron-picker"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={closeTronPicker}
      onKeyDown={(e) => e.key === "Escape" && closeTronPicker()}
    >
      <div
        className="w-full max-w-sm rounded-2xl border-2 border-violet-950 bg-violet-900 p-4 shadow-[0_4px_0_#2e1065]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="font-black text-white">Choose a Tron wallet</p>
          <button
            type="button"
            onClick={closeTronPicker}
            className="text-violet-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {!s.loaded ? (
          <p className="text-sm text-violet-200">Loading wallets…</p>
        ) : (
          <div className="flex flex-col gap-1">
            {s.wallets.map((w) => {
              const icon = safeIcon(w.icon);
              return (
                <button
                  key={w.name}
                  type="button"
                  onClick={() => void connectTron(w.name)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-bold text-white hover:bg-violet-800"
                >
                  {icon ? (
                    <img src={icon} alt="" width={20} height={20} className="h-5 w-5 rounded" />
                  ) : (
                    <span className="h-5 w-5 rounded bg-violet-700" />
                  )}
                  <span className="flex-1">{w.name}</span>
                  {w.installed && <span className="text-xs text-emerald-300">detected</span>}
                </button>
              );
            })}
          </div>
        )}
        {s.error && <p className="mt-2 text-xs text-rose-300">{s.error}</p>}
        <p className="mt-3 text-xs text-violet-400">
          SwapChan builds and checks every Tron transaction before your wallet signs it, and never
          holds your keys.
        </p>
      </div>
    </div>
  );
}
