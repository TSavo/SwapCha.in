# @swapchan/shared — API contract v1 (frozen)

All schemas are zod in `src/index.ts`; import types from here, never redefine them.
All token amounts are **base-unit integer strings** (use `toBaseUnits`/`fromBaseUnits`, viem `parseUnits`). Never floats.
Native token = `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`. Slippage is in bps.

Base URL: `NEXT_PUBLIC_API_URL` (default `http://localhost:8787`). Errors: `{ "error": string, "issues"?: zod issues }` with 4xx/5xx.

| Method | Path               | Input                                      | Output                                                                                                                                     |
| ------ | ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`          | –                                          | `{ ok: true, version: "1", providers: string[] }`                                                                                          |
| GET    | `/chains`          | –                                          | `Chain[]`                                                                                                                                  |
| GET    | `/tokens?chainId=` | optional chainId                           | `Token[]`                                                                                                                                  |
| GET    | `/quotes`          | `QuoteRequest` as query params             | `QuotesResponse` (all quotes ranked best-first by `netUsd`, then `toAmount`; `best` = winning quote id; per-provider failures in `errors`) |
| GET    | `/quote`           | `QuoteRequest`                             | `Quote` (best only; 404 if none)                                                                                                           |
| POST   | `/build`           | `{ quoteId: string, taker: Address }` JSON | `TxRequest` (unsigned; wallet signs)                                                                                                       |
| GET    | `/status`          | `StatusRequest`                            | `StatusResponse`                                                                                                                           |

`taker` is required in `/quotes` if you want `quote.tx` populated; otherwise call `/build`.
Ranking: `netUsd = toAmountUsd - gasUsd - feeUsd`; quotes with `netUsd=null` rank after priced ones by raw `toAmount` (only comparable within the same toToken).

## Additive v1 changes

- `RouteStep.type` adds `"fee"`.
- `Quote.execution` (`"tx"`|`"order"`, default tx) + `Quote.order` (EIP-712; CoW quotes are signed orders, `tx` null).
- `TxRequest.simulation` (`{ ok, method, gasUsed?, error? }`) when `SWAPCHAN_SIMULATE` is set.
- `BuildResponse.permit2` / `.approval`.

## Auth

If `SWAPCHAN_API_KEYS="key1:60,key2:600"` (key:requests-per-minute) is set, every route except `/health` requires `x-api-key: <key>` or `Authorization: Bearer <key>`; 401 if missing/unknown, 429 with `retry-after` when over limit. Unset = open dev mode.
