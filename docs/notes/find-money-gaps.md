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
  BSV (forkid), GRS (legacy-sha256). Every sweep is decoded twice before it is offered: blocktools decodeTx+verifyTx and an
  independent bitcoinjs decode (same inputs in order, one output to the destination, amount + fee = inputs). blocktools'
  BTC-scale high_fee (>1,000,000 base units) / high_fee_rate warnings are accepted only when the fee is under a TS cap
  (row rate x legacy size x 1.25) and high_fee_pct (>5%) is not raised. UTXOs are taken largest first; inputs whose own fee
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
    - PoS-timestamp format (PPC, NVC, BLK, CLAM, RDD): blocked on blocktools pos-ntime sweep_build.
    - ZEC transparent: blocked on blocktools zcash-v5 tx build. QRK: blocktools tx_format "unknown". WDC: blocktools row unverified.
    - XPM, AUR, TRC: blocktools marks legacy sweep_build, but SwapChan has no measured relay fee rate for them (cryptoid
      txinfo is not available on the key tier), so the sweep stays off until a fee rate is measured.
    - NMC, POT, MEC, ANC: no public explorer; "not checked".
