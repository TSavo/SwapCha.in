# SwapChan

**Best-price same-chain and cross-chain crypto swap routing — as an MCP server, with an anime cast.** 🎌

SwapChan fans out a single swap request to 0x, CoW, LI.FI, Across and Relay at once, ranks every route by net USD after gas and fees, and returns an **unsigned** transaction for the winner. It never holds keys and never signs or broadcasts — your wallet does. 12 networks, same-chain and cross-chain.

**[swapchan.com](https://swapchan.com)** · MCP endpoint `https://mcp.swapchan.com/mcp` · Official MCP Registry `io.github.TSavo/swapchan`

## See it work

Your agent asks in plain English → SwapChan fans out to every router, ranks by net USD after gas, and hands back an **unsigned** transaction. Your wallet signs.

![SwapChan agent call: swap 100 USDC Ethereum→Base, routes ranked, unsigned tx built, user confirms](https://raw.githubusercontent.com/TSavo/SwapCha.in/main/docs/agent-call.gif)

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

### Earn 5 bp as an agent builder

Register a partner id with your payout address and pass `partner` to `get_quote` / `compare_routes` (REST: `&partner=<id>`). You earn half of SwapChan's 0.1% fee on every swap with a verified fee:

```sh
curl -X POST https://api.swapchan.com/partners -H 'content-type: application/json' \
  -d '{"name":"My Agent","siteUrl":"https://github.com/me/my-agent","evmAddress":"0xYourPayoutAddress"}'
```

Returns `id`, a private dashboard `token` and `dashboardUrl`. Sites can embed the [widget](https://swapchan.com/widget) or use `?ref=<id>` links. Details: [swapchan.com/partners](https://swapchan.com/partners).

### Tools

| Tool                                                | What it does                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `get_supported_chains`                              | Networks SwapChan routes across (each with its own chan)                                                             |
| `get_supported_tokens`                              | Tokens available per chain                                                                                           |
| `get_quote`                                         | Best single route for a swap                                                                                         |
| `compare_routes`                                    | Every provider ranked by net USD after gas + fees                                                                    |
| `build_swap_tx`                                     | The **unsigned** transaction for a chosen route — your wallet signs                                                  |
| `get_route_status`                                  | Track a cross-chain swap to completion                                                                               |
| `scan_new_tokens` / `scan_trending` / `scan_movers` | Memecoin scanner: new pairs, trending and big movers on Solana, Base, BNB, Ethereum, with risk badges and swap links |
| `token_risk`                                        | Mint/freeze authority, holder concentration, LP, honeypot and tax checks for one token                               |

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
