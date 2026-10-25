/**
 * Plain AppKit options (no runtime imports) so tests can pin them.
 * Option names checked against @reown/appkit-controllers 1.8.24 TypeUtil `Features`
 * and OptionsController (`defaultAccountTypes`, `featuredWalletIds`).
 */

/**
 * WalletConnect explorer ids. MetaMask, Phantom, Coinbase Wallet, Trust, OKX, Ledger Live and
 * Xverse are the ids AppKit itself ships in @reown/appkit-common PresetsUtil.ConnectorExplorerIds;
 * Rabby's is the id Rabby quotes for its own registry listing (RabbyHub/Rabby#3504).
 */
export const FEATURED_WALLETS = {
  metamask: "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
  rabby: "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1",
  phantom: "a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393",
  coinbase: "d0ca99ff52b99abc48743dad0f7fc891e041be73574f7fac4afe5d4bb83845c8",
  trust: "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
  okx: "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709",
  ledgerLive: "19177a98252e07ddfc9af2083ba8e07ef627cb6103467ffebb3f8f4205fd7927",
  xverse: "2a87d74ae02e10bdd1f51f7ce6c4e1cc53cd5f2c0b6b5ad0d7b3007d2b13de7b",
} as const;

export const appKitOptions = {
  themeMode: "dark" as const,
  themeVariables: { "--w3m-accent": "#f5b700", "--w3m-border-radius-master": "4px" },
  metadata: {
    name: "SwapChan",
    description: "Best-price same-chain and cross-chain swaps, with anime.",
    url: "https://swapchan.com",
    icons: ["https://swapchan.com/characters/swapchan.png"],
  },
  featuredWalletIds: Object.values(FEATURED_WALLETS),
  // Regular accounts, not Reown smart accounts.
  defaultAccountTypes: { eip155: "eoa" as const },
  features: {
    // No Reown telemetry (it would see wallet addresses).
    analytics: false,
    // No Reown-hosted embedded wallet in the key path.
    email: false,
    socials: false as const,
    // Built-in swap/onramp would bypass our verified builds.
    swaps: false,
    onramp: false,
  },
};
