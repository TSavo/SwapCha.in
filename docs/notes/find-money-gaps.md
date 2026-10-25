# find_money coverage checklist (internal working notes)

Refreshed 2026-10-24. Tx = SwapChan builds an unsigned, owner-only recovery tx (signed by the connected wallet on
swapchan.com/recover, checked by `verifyRecovery`, which fails closed). No tx = a plain note; only "open protocol" links out.

## Rule: parallel by default (applies to every new check)
- Every source is its own `timed(name, promise, empty, ms)` entry in the single `Promise.all` in `airdropCheck`
  (apps/api/src/intel.ts). Never `await` one source before another.
- Every source has its own deadline; on timeout/error it adds its own "X: not checked (reason)" line, never a silent [].
  Sources that fan out (per chain / per protocol) return `{ items, notChecked }` with per-leg deadlines.
- Explorer/RPC errors (rate limits included) must surface as "not checked", not as "nothing found".
- Cold total time should equal the slowest stage, not the sum. Check the timing log after adding a source.

## Covered (see `git log --grep=find_money`)
- History archaeology on EVM/Tron/Solana/BTC; unknown-contract probing (ABIs + selectors, simulated).
- Legacy: PoWH3D, Fomo3D, EtherDelta, IDEX v1, IronHands/Doublr, P3D clones, Liquity, ENS old-registrar deeds (releaseDeed).
- Lending: Aave v2/v3 + Spark withdraw tx; Compound/Venus detect.
- Vault registry (Yearn, Beefy, Morpho, savings 4626) with redeem tx; maxWithdraw-capped.
- Staked LP: every Curve gauge (7 chains), Convex/Aura, SushiSwap MasterChef; Uniswap v4 exits; Pendle matured PT/LP/SY.
- Staking: Lido + ether.fi/Frax/Swell/Stader queues, Rocket Pool, EigenLayer deposits + queued withdrawals, beacon validators.
- Airdrops with per-address eligibility; Merkl.
- Safes: 1-of-N sweep via execTransaction.
- Vesting/locks: Sablier Lockup/Flow (withdrawMax), Hedgey plans (redeemPlans, 8 chains), Team Finance (withdrawTokens),
  UNCX v2 LP locker (withdraw), Superfluid Super Tokens (downgrade / downgradeToETH, 7 chains).
- Refunds: TheDAO WithdrawDAO (approve, then withdraw; contract-pinned).
- Canonical bridges: Arbitrum unexecuted L2→L1 messages (Outbox.executeTransaction with NodeInterface proof; ETH and token
  gateway), Optimism withdrawals (prove / finalize on OptimismPortal). Both contract-pinned in verifyRecovery.
- Perps: Hyperliquid perp + spot (note only: withdrawals are Hyperliquid-signed), GMX v2 funding fees (claimFundingFees,
  receiver = owner) + open v2 positions (note), GMX v1 staked/rewards.
- Solana: rent, stake, Marinade tickets (claim ix), Kamino obligations (detect).
- Tron: voting rewards, Stake 2.0 unfreeze tx, Stake 1.0, JustLend, sTRX/stUSDT/WTRX (unwrap tx), WIN, BTT, SUN, SUNOLD (note).
- Other chains: BTC xpub, fork coins + same-key LTC/DOGE/FTC, XRP Ledger, Signum, 12 extra EVM chains (native, tokens, approvals).
- Old coins, unsigned sweep (blocktools buildUnsignedSweep only, no TS fallback): DASH, DGB, RVN, VTC, VIA, QTUM, MONA,
  BSV (forkid), GRS (legacy-sha256), TRC (20 sat/B), AUR (103 sat/B), XPM (100312 sat/B), QRK (1 unit/B, 5 decimals), ZEC transparent P2PKH (zcash-v5). Every sweep is decoded twice before it is offered: blocktools decodeTx+verifyTx and an
  independent bitcoinjs decode (same inputs in order, one output to the destination, amount + fee = inputs). blocktools'
  fee verdict (2d179f1: per-coin FeeWarn rows incl. measured DOGE/FTC/MONA, high_fee scaled per started 1000 vB) is final:
  any fee warning refuses the sweep (only "unsigned" is expected). SwapChan's own cap still applies on top (row rate x
  legacy size x 1.25; ZEC also ZIP-317 x 1.25), and high_fee_pct never passes.
  Fee rates: FTC 600 sat/B (blocktools p10 over 100 txs; median 2000; the old 100 was below every sampled tx, so it
  might not relay); DOGE stays at its 1000 sat/B policy rate (relays, under the measured DOGE row).
  ZEC: blocktools' v5 tx is re-parsed by SwapChan's own parseZecV5 and its branch id must equal the explorer's
  chaintip+nextblock consensus id; immature coinbase UTXOs (<100 conf) are skipped. Amounts above 2^53 (RDD) are now
  passed to blocktools as decimal strings and read back from its amount_str / fee_str twins (2d179f1; replaced bigJson). BCH sweeps accept CashAddr (bitcoincash:q/p...) for from/to;
  SwapChan decodes it itself (checksum verified) to the legacy form the builder uses. UTXOs are taken largest first; inputs whose own fee
  would be over 5% of their value are skipped. Live-built 2026-10-24 ~21:40 PDT from real funded addresses (scripts/live-sweeps.ts).
- Old coins, balance (+ UTXO list with the cryptoid key): XPM, CLAM, NVC, AUR, WDC, QRK, BLK via cryptoid; TRC via Insight
  (balance + UTXOs measured 2026-10-24). Cryptoid's `{"addresses":[]}` for a never-seen address is now a measured zero
  (was the unexplained "no answer for address" line on BTC fan-out).

## Known gaps (honest "not checked" or detect-only)
1. Base canonical bridge withdrawals: not checked (no free full-history log source; Etherscan v2 free tier excludes Base,
   Blockscout is Cloudflare-challenged, public RPC rejects full-range logs).
2. OP withdrawals: no live ready-to-prove example seen yet (statuses verified on waiting-to-finalize ones).
3. Team Finance: withdrawTokens simulation reverted on a live unlocked lock; shown with no tx.
4. Kamino: no tx built. Huge Solana wallets hit the balance limit.
5. Blockscout ABI lookups blocked on non-Ethereum chains. Fantom tokens not checked. Extra EVM chains: no vault/lending.
6. Sablier on chains without RPC: "not checked".
7. GMX: ExchangeRouter rotates; perps.ts tries a short router list (first that simulates). Update when GMX redeploys.
   Closing GMX positions / Hyperliquid withdrawals are notes only.
8. Arbitrum retryables (unredeemed L1→L2), zkSync Lite, Hop, other third-party bridges: missing.
9. Tron: SUN.io/SunSwap LP + farms, veSUN, delegated resources, TRC-10 leftovers (old BTT 1002000), WINk staking: missing.
10. ICO refund contracts beyond TheDAO; old DEX balances (Bancor, Kyber, 0x v1), Augur v1 REP: missing.
11. dYdX v3 L1 exit, Perp v1, Synthetix perps margin; Drift, Mango v3: missing.
12. Off-chain claims (FTX, Celsius, Mt.Gox): not on-chain; info only.
13. Old coins with balance but no sweep yet:
    - Done: PPC, NVC, CLAM, RDD sweep via blocktools buildUnsignedSweepAt (pos-ntime, unsigned tx + nTime + prevouts, no
      PSBT; checked by verifyTx/decodeTx on the envelope plus SwapChan's own parsePosTx). BLK sweeps as legacy. Fee rates:
      PPC 11 and RDD 110 units/B (measured from real txs); NVC 6, CLAM 53, BLK 53 (node min fee per started kB).
      NVC balances via cryptoid were reported 100x high (key API is always 1e8 units); fixed.
    - Done 2026-10-25: TRC (15, CHAINS.md 14.8 over 14 txs), AUR (103, blocktools-measured 102.8), ZEC transparent t1 only
      (untested: broadcast, v6 / NU7, t3/P2SH, shielded). GRS xpub (Groestl-checksum; P2PKH/P2WPKH/P2TR via
      Blockbook's own xpub lookup with pkh()/wpkh()/tr() descriptors, Blockbook's gap limit, 3 calls one at a time, 429
      retried twice, own 12 s deadline inside the 17 s stage, else "not checked"; every funded address is re-derived by
      blocktools addressesFromXpub and a mismatch is refused. The first version (45 per-address lookups) hit 429, and
      paced it took ~17 s and was cut by the stage deadline) and grs1p detection; taproot spend refused. Monero: classify only (balance needs
      the private view key, which SwapChan never takes).
    - Done 2026-10-25 (blocktools 2d179f1): XPM at its measured 100312 sat/B (per-coin rate cap); QRK as legacy, 5 decimals
      (Quark COIN = 1e5), 1 unit/B = 10x Quark's relay minimum (source, not measured). TRC re-measured: 20 sat/B. MONA
      220 -> 100 (Monacoin Core wallet default, blocktools MONA verdict). Not yet confirmed: cryptoid's keyed QRK amounts
      being 1e8 units (assumed like NVC/PPC; scaled /1000).
    - Still off: WDC: blocktools row unverified.
    - NMC, POT, MEC, ANC: no public explorer; "not checked".
14. Stellar: G-addresses (blocktools detectAddress "xlm") read from Horizon: spendable XLM = balance - (2 + subentries
    + sponsoring - sponsored) x base reserve - selling liabilities; other assets are leads. No sweep tx built; claimable
    balances, LP shares and offers not listed yet.
    XLM and XRP spendable amounts are listed as "Spendable balance" (not rewards); Horizon/XRPL nodes appear in sources/checked.
15. Algorand (ALGO) and Cosmos Hub (ATOM): CHECKED, keyless, own parallel stage + timeout + "not checked" fallback.
    ALGO: algod /v2/accounts (algonode.cloud, fallback nodely.dev); spendable = amount - min-balance; notes opt-ins and
    rekey (auth-addr). ATOM: LCD bank/delegations/unbonding/rewards (publicnode, cosmos.directory, polkachu, keplr);
    liquid = balance, rewards = claimable, staked/unbonding/other denoms = lead. No sweeps or tx building.
    TON, Cardano (ADA), Polkadot (DOT): CHECKED too (apps/api/src/ledgers2.ts), same pattern.
    TON: toncenter getAddressBalance (one call per scan; keyless ~1 req/s, 429 falls to tonapi.io /v2/accounts);
    frozen accounts are a lead. Jettons and staked/liquid-staked TON are NOT checked.
    ADA: Koios address_info + account_info; this address = Spendable balance (min-UTXO note for token UTXOs),
    rewards_available = Unclaimed rewards, other addresses on the same stake key and the 2 ADA key deposit = leads.
    Only one keyless Koios endpoint exists (no fallback). Only addr1 (Shelley) is recognised; stake1/Byron are not.
    DOT: Asset Hub (where balances live since the 2025-11-04 migration; ED 0.01 DOT) and relay chain (ED 1 DOT), each
    Parity public sidecar balance-info, fallback public RPC state_getStorage System.Account (own blake2b + SCALE
    decode). Spendable = free - max(frozen - reserved, 0); frozen/reserved = lead. The Asset Hub sidecar was down
    (500, WebSocket not connected) on 2026-10-24, so Asset Hub currently answers via RPC. Subscan needs a key (403).
    Not checked: DOT nomination-pool membership and pending staking rewards, parachain balances.

## find_money latency (2026-10-25)

Production (4 parallel scans, 02:18 PDT) logged find_money_watchdog 23/41 checks timed out: balances/lending/gas at
17 s and most sources at 12 s, with ethereum-rpc.publicnode.com averaging 4.6 s per request (peak 75 in flight).
Measured locally (box, 4 parallel scans of public addresses):
- viem multicall chunks were 1024 bytes (~28 calls), so one scan sent ~310 aggregate3 requests to the Ethereum RPC.
  Chunks are now 8192 bytes (EVM_MULTICALL_BATCH_BYTES): Ethereum RPC requests 247-396 -> 134-167 per 4 scans,
  peak in flight 43-149 -> ~37.
- "history <chain>" (explorer txlist/tokentx/tokennfttx, then probes) was the stage that timed out: about half of one
  scan's ~40 Etherscan calls came back rate-limited and were retried after sleeps, and the three lists were fetched
  one after another. Now: Ethereum uses Routescan first (keyless; Etherscan then Blockscout are fallbacks), Linea uses
  its Blockscout first (more complete for the tested address), and the three lists are fetched in parallel.
  Timeouts per 4 parallel scans: 15-16 -> 2-4 (two runs each).
- Tried and dropped: a process-wide Etherscan pacer (2.5-4 calls/s). It removed rate-limit retries but made scans
  queue, so more sources hit their deadlines (13-15 timeouts per 4 scans).
- Still slow: history Optimism (optimism.blockscout.com, ~2.7 s per call, no keyless alternative wired) and history
  Polygon/Arbitrum when the Etherscan key is busy. Not measured on production under load (no load tests there).

### Production results after 6297e74 (2026-10-25, ~2:45 AM PDT, one request each)
- FTC sweep (feeRate 600): HTTP 200 in 5.2 s, fee 17,787,000, amount 725,119,522,386; built and verified.
- QRK sweep (QWS31ayUfLjjfykohodFSauzr5rgzZu6oo): HTTP 200 in 4.7 s, fee 1229. Before the P2PK filter below, main did not check output scripts, so a P2PK UTXO could have been included and labelled as P2PKH.
- GRS xpub: still "not checked (GRS explorer unavailable (403))".
- find_money (0xd8dA…6045, single scan): HTTP 200 in 15.9 s. Timeouts: history Optimism and history Scroll (15 s each). Slowest stages: claimables 15.1 s, approvals 7.4 s. Optimism bridge withdrawals failed on an RPC error (mainnet.optimism.io). Not comparable to the 23/41 baseline, which was 4 parallel scans; production under parallel load not measured.

### QRK P2PK
QRK sweeps keep only UTXOs whose cryptoid-reported script equals the address's own P2PKH script; P2PK UTXOs are skipped (noted in the result), and the sweep is refused when cryptoid returns no scripts (blocktools cannot verify P2PK inputs).
