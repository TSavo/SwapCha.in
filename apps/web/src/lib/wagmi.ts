import {
  type AppKitNetwork,
  arbitrum,
  avalanche,
  base,
  bsc,
  linea,
  mainnet,
  optimism,
  polygon,
  scroll,
  solana,
} from "@reown/appkit/networks";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { http } from "viem";
import { cookieStorage, createConfig, createStorage, injected } from "wagmi";
import {
  arbitrum as wArb,
  avalanche as wAvax,
  base as wBase,
  bsc as wBsc,
  linea as wLinea,
  mainnet as wMain,
  optimism as wOp,
  polygon as wPoly,
  scroll as wScroll,
} from "wagmi/chains";

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
export const hasAppKit = projectId.length > 0;

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  bsc,
  avalanche,
  linea,
  scroll,
  solana,
];

/** Solana wallets (Phantom, Solflare, Backpack...) through AppKit. */
export const solanaAdapter = hasAppKit ? new SolanaAdapter() : null;

export const wagmiAdapter = hasAppKit
  ? new WagmiAdapter({
      networks,
      projectId,
      ssr: true,
      storage: createStorage({ storage: cookieStorage }),
    })
  : null;

/** Without a Reown project id we fall back to injected wallets only (e.g. MetaMask). */
export const wagmiConfig =
  wagmiAdapter?.wagmiConfig ??
  createConfig({
    chains: [wMain, wBase, wArb, wOp, wPoly, wBsc, wAvax, wLinea, wScroll],
    connectors: [injected()],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [wMain.id]: http(),
      [wBase.id]: http(),
      [wArb.id]: http(),
      [wOp.id]: http(),
      [wPoly.id]: http(),
      [wBsc.id]: http(),
      [wAvax.id]: http(),
      [wLinea.id]: http(),
      [wScroll.id]: http(),
    },
  });
