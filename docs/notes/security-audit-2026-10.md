# Security audit fixes (2026-10-25)

Verified against code before fixing; each fix has regression tests.

| # | Finding | Status | Fix |
|---|---|---|---|
| 1 | verify_tx `expected.recipient` / `minOut` were no-ops (recipient only checked on a decoded `transfer`; minOut compared two caller numbers) | confirmed | `outcomeChecks` in `apps/api/src/txtools.ts`: checked against the eth_simulateV1 transfer trace; can't simulate = danger; recipient only in calldata (cross-chain) = warn. Optional `expected.outToken`. Tron path unchanged. |
| 2 | build_swap_tx / frontend accepted a foreign recipient and called it "verified" | confirmed | `/build` refuses a same-VM recipient != taker unless `allowForeignRecipient: true`; response carries `payoutTo` + `recipientIsTaker`; MCP surfaces `payoutWarning`. |
| 3 | `/build` didn't pin payout to the taker (cached quote's `recipient` was inherited) | confirmed | `payoutFor()` in `apps/api/src/index.ts`; quote recipient is dropped for same-VM; cross-VM requires an explicit recipient (body or quote). |
| 4 | /recover sign button live for redeem/claim/collect paying someone else | confirmed | `apps/web/src/lib/recoverCheck.ts`: every receiver/holder must equal the connected wallet (zero rejected). Remote `recover-verify` path unchanged (fail-closed). |
| 5 | /recover open redirect via `next=//evil` or `/\evil` | confirmed | `apps/web/src/lib/safeNext.ts`. |
| 6 | "Permit2" approve mode was an unlimited approve | confirmed | Mode removed; approvals are always exactly the swap amount. |
| 7 | Swap card signed the API response blindly | confirmed | `apps/web/src/lib/buildCheck.ts` (`assertBuilt`): verified, payoutTo, chainId, native value cap, approval = exact `approve(spender, amount)` on fromToken with spender = tx.to/quote.approvalAddress, CoW order receiver/tokens/amount. Solana/Tron/Bitcoin: verified + payoutTo only (payloads opaque client-side). |
| 8 | GA got full URLs (`/dashboard/<address or ENS>`, query, titles with addresses) and tx hashes in events | confirmed | `apps/web/src/lib/gaUrl.ts`: sanitised page_location/referrer/title set before the first hit (inlined), `send_page_view:false` + manual page_view on route change; `gaParams` strips addresses/hashes from events (host/partner callbacks keep full params). |

Low severity, done: widget `postMessage` targets the embedding origin (ancestorOrigins/referrer, else nothing); partner dashboard token moved to `#t=` (old `?t=` still read); warning when a `?recipient=` deep link differs from the connected wallet.

Remaining:
- GA admin: turn off Enhanced Measurement "page changes based on browser history events" (would duplicate page_views) and consider "outbound clicks" (link_url can carry explorer URLs with addresses). Code can't disable these.
- Partner API still takes the token as `?t=` on api.swapchan.com (server logs); move to a header later.
- Cross-chain EVM swaps from an ERC-20 allow a non-zero native value (bridge messaging fee) with no cap.
