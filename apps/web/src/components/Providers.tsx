"use client";

import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";
import { appKitOptions } from "@/lib/appkitConfig";
import {
  bitcoinAdapter,
  networks,
  projectId,
  solanaAdapter,
  wagmiAdapter,
  wagmiConfig,
} from "@/lib/wagmi";

if (wagmiAdapter) {
  createAppKit({
    adapters: [wagmiAdapter, solanaAdapter, bitcoinAdapter].filter((a) => a !== null),
    networks,
    projectId,
    ...appKitOptions,
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
