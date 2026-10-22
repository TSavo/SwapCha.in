"use client";

import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";
import { networks, projectId, wagmiAdapter, wagmiConfig } from "@/lib/wagmi";

if (wagmiAdapter) {
  createAppKit({
    adapters: [wagmiAdapter],
    networks,
    projectId,
    themeMode: "dark",
    themeVariables: { "--w3m-accent": "#f5b700", "--w3m-border-radius-master": "4px" },
    metadata: {
      name: "SwapChan",
      description: "Best-price same-chain and cross-chain swaps, with anime.",
      url: "https://swapcha.in",
      icons: ["https://swapcha.in/characters/swapchan.png"],
    },
    features: { analytics: false },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
