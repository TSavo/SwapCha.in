# SwapChan v2 (WIP)

Best-price same-chain + cross-chain swap aggregator with an anime cast. Rebuilt from scratch; the 2023 CRA/antd/1inch-v5 app is gone.

```
apps/api      Hono quote service (fan-out to providers, rank, build tx, status)
apps/web      Next.js App Router + wagmi/viem + Reown AppKit + Tailwind
apps/mcp      MCP server (get_quote etc.) on top of apps/api
packages/shared  zod types + HTTP contract (see packages/shared/README.md)
```

## Run

```sh
nvm use            # Node 24 LTS
corepack enable    # pnpm 10
pnpm install
cp .env.example .env   # fill keys
pnpm dev
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
