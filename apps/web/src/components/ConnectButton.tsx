"use client";

import { useAppKit } from "@reown/appkit/react";
import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { pickableConnectors, safeIcon } from "@/lib/injectedWallets";
import { hasAppKit } from "@/lib/wagmi";

function ConnectLabel({ full }: { full: boolean }) {
  if (full) return <>Connect wallet</>;
  return (
    <>
      Connect<span className="hidden sm:inline"> wallet</span>
    </>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const big =
  "block w-full cursor-pointer rounded-2xl border-2 border-violet-950 bg-amber-400 py-4 text-xl font-black text-violet-950 shadow-[0_4px_0_#2e1065] transition hover:bg-amber-300 active:translate-y-0.5";
const small =
  "cursor-pointer rounded-full border-2 border-violet-950 bg-amber-400 px-3 py-1.5 text-sm sm:px-4 font-bold text-violet-950 shadow-[0_3px_0_#2e1065] transition hover:bg-amber-300 active:translate-y-0.5";

function AppKitButton({ cls }: { cls: string }) {
  const { open } = useAppKit();
  const { address } = useAccount();
  return (
    <button type="button" className={cls} onClick={() => open()}>
      {address ? short(address) : <ConnectLabel full={cls === big} />}
    </button>
  );
}

function InjectedButton({ cls }: { cls: string }) {
  const { address } = useAccount();
  const { connect, connectors, error, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const wallets = pickableConnectors(connectors);
  if (address)
    return (
      <button type="button" className={cls} onClick={() => disconnect()}>
        {short(address)}
      </button>
    );
  return (
    <div className="relative">
      <button
        type="button"
        className={cls}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ConnectLabel full={cls === big} />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="wallet-picker"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border-2 border-violet-950 bg-violet-900 p-2 text-left shadow-[0_4px_0_#2e1065]"
        >
          {wallets.length === 0 ? (
            <p className="p-2 text-sm text-violet-200">
              No browser wallet found. Install one (MetaMask, Rabby, Phantom, OKX…) and reload.
            </p>
          ) : (
            wallets.map((c) => {
              const icon = safeIcon(c.icon);
              return (
                <button
                  key={c.uid}
                  type="button"
                  role="menuitem"
                  disabled={isPending}
                  onClick={() => {
                    setOpen(false);
                    connect({ connector: c });
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-50"
                >
                  {icon ? (
                    <img src={icon} alt="" width={20} height={20} className="h-5 w-5 rounded" />
                  ) : (
                    <span className="h-5 w-5 rounded bg-violet-700" />
                  )}
                  {c.id === "injected" ? "Browser wallet" : c.name}
                </button>
              );
            })
          )}
          {error && <p className="p-2 text-xs text-rose-300">{error.message.split("\n")[0]}</p>}
        </div>
      )}
    </div>
  );
}

export function ConnectButton({ primary = false }: { primary?: boolean }) {
  const cls = primary ? big : small;
  return hasAppKit ? <AppKitButton cls={cls} /> : <InjectedButton cls={cls} />;
}
