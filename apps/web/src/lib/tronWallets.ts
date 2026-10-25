import type { Adapter } from "@tronweb3/tronwallet-abstract-adapter";
import { appKitOptions } from "@/lib/appkitConfig";

/**
 * Tron wallet adapters (@tronweb3/tronwallet-adapters). Only ever reached through a dynamic
 * import from lib/tron.ts, so none of this ships until a page actually needs Tron.
 */
export async function createTronAdapters(projectId: string): Promise<Adapter[]> {
  const [tl, okx, bitget, tp, bybit, gate, ledger] = await Promise.all([
    import("@tronweb3/tronwallet-adapter-tronlink"),
    import("@tronweb3/tronwallet-adapter-okxwallet"),
    import("@tronweb3/tronwallet-adapter-bitkeep"),
    import("@tronweb3/tronwallet-adapter-tokenpocket"),
    import("@tronweb3/tronwallet-adapter-bybit"),
    import("@tronweb3/tronwallet-adapter-gatewallet"),
    import("@tronweb3/tronwallet-adapter-ledger"),
  ]);
  const list: Adapter[] = [
    new tl.TronLinkAdapter({ dappName: "SwapChan", dappIcon: appKitOptions.metadata.icons[0] }),
    new okx.OkxWalletAdapter(),
    new bitget.BitKeepAdapter(),
    new tp.TokenPocketAdapter(),
    new bybit.BybitWalletAdapter(),
    new gate.GateWalletAdapter(),
  ];
  if (projectId) {
    const wc = await import("@tronweb3/tronwallet-adapter-walletconnect");
    list.push(
      new wc.WalletConnectAdapter({
        network: "Mainnet",
        options: { projectId, metadata: appKitOptions.metadata },
        themeMode: "dark",
        themeVariables: appKitOptions.themeVariables,
        // Same rule as AppKit: no Reown telemetry.
        enableAnalytics: false,
      }),
    );
  }
  // Ledger pins an older abstract-adapter; same public surface.
  list.push(new ledger.LedgerAdapter({ accountNumber: 2 }) as unknown as Adapter);
  return list;
}
