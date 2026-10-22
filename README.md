# SwapChan

**Best-price same-chain and cross-chain crypto swap routing — as an MCP server, with an anime cast.** 🎌

SwapChan fans out a single swap request to 0x, CoW, LI.FI, Across and Relay at once, ranks every route by net USD after gas and fees, and returns an **unsigned** transaction for the winner. It never holds keys and never signs or broadcasts — your wallet does. 12 networks, same-chain and cross-chain.

**[swapchan.com](https://swapchan.com)** · MCP endpoint `https://mcp.swapchan.com/mcp` · Official MCP Registry `io.github.TSavo/swapchan`

![Swap-chan](https://swapchan.com/characters/swapchan.png)

## Use it as an MCP server

Hosted, keyless, zero setup:

```sh
claude mcp add --transport http swapchan https://mcp.swapchan.com/mcp
```

Any MCP client, via stdio bridge:

```json
{
  "mcpServers": {
    "swapchan": { "command": "npx", "args": ["-y", "mcp-remote", "https://mcp.swapchan.com/mcp"] }
  }
}
```

### Tools

| Tool                   | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `get_supported_chains` | Networks SwapChan routes across (each with its own chan)            |
| `get_supported_tokens` | Tokens available per chain                                          |
| `get_quote`            | Best single route for a swap                                        |
| `compare_routes`       | Every provider ranked by net USD after gas + fees                   |
| `build_swap_tx`        | The **unsigned** transaction for a chosen route — your wallet signs |
| `get_route_status`     | Track a cross-chain swap to completion                              |

### Networks

Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, Scroll — plus Bitcoin, Solana and Tron. Same-chain and cross-chain.

### Open by design

SwapChan's MCP server is keyless on purpose. It's per-IP rate-limited, slippage-capped, and `build_swap_tx` only ever returns an **unsigned** transaction — the server has no keys, never signs, and never moves funds. Try it with zero setup.

---

## Develop

Monorepo (pnpm + turbo):

```
apps/api      Hono quote service (fan-out to providers, rank, build tx, status)
apps/web      Next.js App Router + wagmi/viem + Reown AppKit + Tailwind
apps/mcp      MCP server (get_quote etc.) on top of apps/api
packages/shared  zod types + HTTP contract (see packages/shared/README.md)
```

### Run

```sh
nvm use            # Node 24 LTS
corepack enable    # pnpm 10
pnpm install
cp .env.example .env   # fill keys
pnpm dev           # api :8787, web :3000, mcp :8788/mcp (anonymous in dev)
pnpm -F @swapchan/mcp e2e   # live MCP smoke against the running stack
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
