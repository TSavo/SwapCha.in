"use client";

import { useAppKit } from "@reown/appkit/react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
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
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const c = connectors[0];
  return address ? (
    <button type="button" className={cls} onClick={() => disconnect()}>
      {short(address)}
    </button>
  ) : (
    <button
      type="button"
      className={cls}
      disabled={!c}
      onClick={() => c && connect({ connector: c })}
    >
      <ConnectLabel full={cls === big} />
    </button>
  );
}

export function ConnectButton({ primary = false }: { primary?: boolean }) {
  const cls = primary ? big : small;
  return hasAppKit ? <AppKitButton cls={cls} /> : <InjectedButton cls={cls} />;
}
