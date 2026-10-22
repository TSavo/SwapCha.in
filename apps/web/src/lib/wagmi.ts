import {
  type AppKitNetwork,
  arbitrum,
  base,
  mainnet,
  optimism,
  polygon,
} from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { http } from "viem";
import { cookieStorage, createConfig, createStorage, injected } from "wagmi";
import {
  arbitrum as wArb,
  base as wBase,
  mainnet as wMain,
  optimism as wOp,
  polygon as wPoly,
} from "wagmi/chains";

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
export const hasAppKit = projectId.length > 0;

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
];

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
    chains: [wMain, wBase, wArb, wOp, wPoly],
    connectors: [injected()],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [wMain.id]: http(),
      [wBase.id]: http(),
      [wArb.id]: http(),
      [wOp.id]: http(),
      [wPoly.id]: http(),
    },
  });
