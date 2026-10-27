# SwapChan

**Best-price same-chain and cross-chain crypto swap routing — as an MCP server, with an anime cast.** 🎌

SwapChan fans out a single swap request to 0x, CoW, LI.FI, Across and Relay at once, ranks every route by net USD after gas and fees, and returns an **unsigned** transaction for the winner. It never signs, never holds keys or funds, and never controls your money — your wallet signs. The optional `broadcast_tx` only relays a transaction you already signed locally, unchanged, to 51 chains (EVM, Bitcoin and its forks, Solana, Tron, XRP, Stellar, Algorand, Cosmos Hub, Polkadot, TON, Cardano); it can't alter it. 12 networks, same-chain and cross-chain.

**[swapchan.com](https://swapchan.com)** · MCP endpoint `https://mcp.swapchan.com/mcp` · Official MCP Registry `io.github.TSavo/swapchan`

## See it work

Your agent asks in plain English → SwapChan fans out to every router, ranks by net USD after gas, and hands back an **unsigned** transaction. Your wallet signs.

![SwapChan agent call: swap 100 USDC Ethereum→Base, routes ranked, unsigned tx built, user confirms](https://raw.githubusercontent.com/TSavo/SwapCha.in/main/docs/agent-call.gif)

### find_money: paste your addresses, get your money back

Paste wallet addresses into your agent → `find_money` scans every chain and contract the wallet touched, ranks what's recoverable, and builds **unsigned** recovery txs (unwrap, withdraw, redeem) plus one swap-to-USDC link. Results are cached for 3 minutes and carry `asOf`, `block` and `cached`; pass `fresh` (`fresh=1` on `/onchain/money`, rate-limited per address) to re-scan. If a source times out, the result has `partial: true` and `incompleteSources`, the headline says totals are a lower bound, and it is cached for only about 20 seconds. Real numbers from a live run on vitalik.eth, plus an archive replay of a real P3D recovery.

Coverage goes beyond EVM: Solana, Tron, Bitcoin, Bitcoin forks and old coins (BCH, BTG, LTC, DOGE and FTC, DASH, DGB, RVN, VTC, VIA, QTUM, MONA, BSV, GRS, PPC, NVC, CLAM, RDD, BLK, Zcash transparent (t1), TRC, AUR, XPM and QRK), each with an unsigned sweep you sign offline in the coin's own wallet (old-coin sweeps are offered only after a Rust/WASM transaction library has built and verified them and an independent second decode agrees), and balances on XRP, XLM, ALGO, ATOM (Cosmos Hub), DOT, TON, ADA and Signum. Exits from liquidity and Pendle positions carry live-quoted minimums and a 20-minute deadline. Short links use unguessable ids.

Lost the wallet app but still have the phrase, keystore or key? `recovery_guide` (and [swapchan.com/recover](https://swapchan.com/recover)) walks you through deriving your **public** addresses offline with [blocktools](https://github.com/TSavo/blocktools) ([v0.1.1 release](https://github.com/TSavo/blocktools/releases/tag/v0.1.1): Linux x86_64 only, check it with `sha256sum -c SHA256SUMS`; other systems build from source), e.g. `seed-to-master < seed.txt | derive --preset scan-js --address-list > addresses.txt`, then pasting addresses.txt into `find_money_batch`. Your seed and keys never leave your machine; SwapChan never sees them.

![SwapChan find_money: paste addresses, scan chains, "I found $4,538 for you", ranked recovery steps, swap all to USDC](https://raw.githubusercontent.com/TSavo/SwapCha.in/main/docs/find-money.gif)

## Use it as an MCP server

Hosted, keyless, zero setup:

```sh
claude mcp add --transport http swapchan https://mcp.swapchan.com/mcp
```

Any MCP client, via stdio bridge:

```json
{
  "mcpServers": {
    "swapchan": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.swapchan.com/mcp"]
    }
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
| `contract_abi`                                      | Contract ABI from Sourcify / Etherscan (or pasted), proxies followed (5 kinds)                                       |
| `contract_read`                                     | eth_call a view function and decode it (failed read = error, never zero)                                             |
| `contract_encode_call`                              | Unsigned call data + decoded view for your own wallet to send                                                        |
| `contract_approve_call`                             | Pre-signing verdict (blocktools approve + verifyTx); do not send on fail                                             |
| `contract_build_creation`                           | Unsigned contract creation: initcode, keccak, predicted address                                                      |
| `get_supported_tokens`                              | Tokens available per chain                                                                                           |
| `get_quote`                                         | Best single route for a swap                                                                                         |
| `compare_routes`                                    | Every provider ranked by net USD after gas + fees                                                                    |
| `build_swap_tx`                                     | The **unsigned** transaction for a chosen route — your wallet signs                                                  |
| `get_route_status`                                  | Track a cross-chain swap to completion                                                                               |
| `scan_new_tokens` / `scan_trending` / `scan_movers` | Memecoin scanner: new pairs, trending and big movers on Solana, Base, BNB, Ethereum, with risk badges and swap links |
| `token_risk`                                        | Mint/freeze authority, holder concentration, LP, honeypot and tax checks for one token                               |
| `get_wallet_balances`                               | Token balances + USD value for any EVM, Solana, Bitcoin or Tron address.                                             |
| `check_approvals`                                   | Open ERC-20 allowances with risk flags; build_revoke_tx makes the approve(0) tx.                                     |
| `explain_transaction`                               | Plain-English summary of any EVM, Solana, Bitcoin or Tron transaction.                                               |
| `get_gas`                                           | Live gas/fee prices across chains, cheapest first.                                                                   |
| `token_info`                                        | Price, liquidity, supply, holders and risk checks for one token.                                                     |
| `resolve_name`                                      | ENS, Basenames and .sol names to addresses, and back.                                                                |
| `watch_token`                                       | Price watches with list_watches / check_watches (pull, no push).                                                     |
| `get_yields`                                        | Top DefiLlama yield pools for an asset, with a swap-in link.                                                         |

### Networks

Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, Scroll — plus Bitcoin, Solana and Tron. Same-chain and cross-chain. Litecoin, Dogecoin and Bitcoin Cash swap through THORChain only, in both directions. Payout and refund addresses are checked by blocktools. To send them you either get an unsigned PSBT (built and checked by blocktools: THORChain vault, exact amount, memo, change back to you, no RBF, fee cap) that you sign in your own wallet, or a THORChain deposit address with the exact amount, the required memo, the minimum and the expiry (not from an exchange: exchanges cannot add the memo). Progress is tracked read-only by txid.

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
