# find_money coverage checklist (internal working notes)

Status: covered / partial / missing. Tx = can SwapChan build an owner-only recovery tx.

## Already covered (before this branch)
- History archaeology (evmArchaeology): any contract the wallet called or got tokens from, on 1/10/534352/43114 keyless (+8453/42161/137/56 with ETHERSCAN_API_KEY). Probes balanceOf, ERC-4626 asset/convertToAssets, Yearn v2 pricePerShare, Uni-v2 LP, reward views. Capped at 400 contracts.
- Legacy: PoWH3D, Fomo3D, EtherDelta, IDEX v1, Liquity troves + surplus.
- Lending (Aave v2/v3 on 9 chains, Compound v2/v3, Venus): detect, link out (no tx).
- Curve 3 hard-coded gauges, Convex cvxCRV rewards; Synthetix; Sablier; vePENDLE; GMX; Rocket Pool deposit pool; OP/Base/Arb L2 withdrawals; Polygon exits; Multichain/Celer (detect); Merkl rewards; merkle airdrops (UNI/ENS/1INCH/OP/ARB; eligibility unknown = BUG); WETH-style unwrap on 7 chains; Lido withdrawal queue; Safes owned (list only); Solana rent + stake + archaeology; BTC xpub; Tron: voting rewards, Stake 2.0 expired unfreeze (tx), frozen v2 (detect), Stake 1.0, JustLend, sTRX/stUSDT/WTRX balances.

## This branch
- [x] Vault registry (vaults.ts): Yearn v2/v3 (yDaemon), Beefy, Morpho (API list), sDAI, sUSDS, sfrxETH, scrvUSD, sUSDe on 7 EVM chains, history-independent. redeem/withdraw(shares) tx. Live: Morpho steakUSDC holder ~$1.63M exact; Yearn yvUSDC v2 holder ~$2.23M estimate. ~1-2s.

## Missing / partial (ranked roughly by money x ease)
1. [ ] Merkle airdrop eligibility from published trees (UNI/ENS/1INCH) + claim tx; drop "eligibility unknown" items. Tx: yes.
2. [ ] "Get it back" must never link out; use connected wallet flow on /recover. (web)
3. [ ] Aave/Compound/Spark supplied-but-idle: build withdraw(asset,max,owner) tx (currently link only). Tx: yes.
4. [ ] Beacon chain: validators with 0x00 creds (need BLS change, detect only), exited validators, 0x01 balances (auto-swept; detect). Beaconcha.in API.
5. [ ] EigenLayer: queued withdrawals completable (DelegationManager completeQueuedWithdrawal), strategy shares. Tx: yes.
6. [ ] LST queues beyond Lido: Rocket Pool rETH burn, ether.fi, Swell, Stader, Frax redemption queue NFTs. Tx: yes mostly.
7. [ ] Uniswap v3/v4 + Sushi LP NFTs: uncollected fees + liquidity (collect tx already allow-listed). Tx: yes.
8. [ ] Convex/Aura/Curve: all gauges/reward pools via APIs, not 3 hard-coded. Tx: yes.
9. [ ] Pendle PT matured redeem, YT interest, LP rewards. Tx: yes.
10. [ ] Safe-held funds: run find_money on each owned Safe and value it; tx via Safe tx (needs Safe flow).
11. [ ] HEX ended stakes (stakeEnd) - bug from 0xeb0e run. Tx: yes, low value usually.
12. [ ] GREED / P3D-clone dividends unpriced (bug). Approval check failing on OP/Polygon/Linea/Scroll (bug). Spam airdrop labels in history (bug). read_chain revert blame (bug).
13. [ ] Tron: delegated energy/bandwidth (undelegate), SUN.io/SunSwap LP + farms, JustLend withdraw tx, sTRX unstake queue, old WINk/BTT/TRONbet staking, TRC-10 leftovers, Stake 1.0 unfreeze tx.
14. [ ] Euler v1 redemption, Notional, Gearbox, Sommelier, Idle, Harvest, Pickle, Balancer v2 internal balances. Mostly 4626/pricePerShare -> extend curated list.
15. [ ] ENS: expired-name registration refunds n/a; old ENS deed (Registrar v1 deeds releaseDeed) - real ETH. Tx: yes.
16. [ ] ICO refund contracts, DAO refunds (TheDAO WithdrawDAO), old DEX balances (Bancor, Kyber, 0x v1, Ox, Augur v1 REP migration).
17. [ ] Bridges: Arbitrum retryables unredeemed, zkSync Lite, Hop bonder leftovers, Optimism Gateway old.
18. [ ] Vesting/locked: Hedgey, Team Finance, Unicrypt, Llamapay, Superfluid deposits.
19. [ ] Perps/margin: dYdX v3 (L1 exit), GMX v1 positions, Perp v1, Synthetix perps margin.
20. [ ] Solana: Marinade/Jito unstake tickets, Kamino, Drift, Mango v3 leftovers.
21. [ ] Off-chain claims (FTX, Celsius, Mt.Gox): not on-chain; info only.
