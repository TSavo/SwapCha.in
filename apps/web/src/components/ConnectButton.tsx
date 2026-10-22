"use client";

import { useAppKit } from "@reown/appkit/react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { hasAppKit } from "@/lib/wagmi";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const cls =
  "rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-violet-950 shadow-[0_0_20px_rgba(245,183,0,.5)] hover:bg-amber-300";

function AppKitButton() {
  const { open } = useAppKit();
  const { address } = useAccount();
  return (
    <button type="button" className={cls} onClick={() => open()}>
      {address ? short(address) : "Connect wallet"}
    </button>
  );
}

function InjectedButton() {
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
      Connect wallet
    </button>
  );
}

export function ConnectButton() {
  return hasAppKit ? <AppKitButton /> : <InjectedButton />;
}
