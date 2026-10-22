"use client";

import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { type Provider, useAppKitConnection } from "@reown/appkit-adapter-solana/react";
import { hasAppKit } from "./wagmi";

export interface SolanaWallet {
  address: string | undefined;
  provider: Provider | undefined;
  connection: ReturnType<typeof useAppKitConnection>["connection"];
  open: () => void;
}

function useSolanaAppKit(): SolanaWallet {
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" });
  const { walletProvider } = useAppKitProvider<Provider>("solana");
  const { connection } = useAppKitConnection();
  const { open } = useAppKit();
  return {
    address: isConnected ? address : undefined,
    provider: walletProvider,
    connection,
    open: () => void open({ view: "Connect", namespace: "solana" }),
  };
}
const NONE: SolanaWallet = {
  address: undefined,
  provider: undefined,
  connection: undefined,
  open: () => {},
};
const useNone = () => NONE;

/** Solana wallet via AppKit; inert without a Reown project id (hasAppKit is build-time constant). */
export const useSolana: () => SolanaWallet = hasAppKit ? useSolanaAppKit : useNone;
