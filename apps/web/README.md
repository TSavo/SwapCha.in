# @swapchan/web

Next.js 16 (App Router) + Tailwind 4 + wagmi 3 / viem + Reown AppKit.
- `pnpm --filter @swapchan/web dev` → http://localhost:3000
- `NEXT_PUBLIC_API_URL` (default `http://localhost:8787`). If the API is unreachable, the app
  switches to **demo mode**: mock chains/tokens/quotes/status, and swaps are simulated (nothing is sent on-chain).
  Force with `NEXT_PUBLIC_MOCK_API=1`.
- `NEXT_PUBLIC_REOWN_PROJECT_ID` enables the AppKit modal; without it, injected wallets (MetaMask etc.) only.
- Character art: drop final PNGs into `public/characters/{swapchan,ethereum,solana,base,arbitrum,optimism,polygon}.png` (current files are placeholders).

Pages: `/` swap, `/cast` characters, `/status?provider=&txHash=&fromChainId=&toChainId=` tracker.
