# Use a chain without its wallet app (example: older coins like Feathercoin, Peercoin, Qtum)

You don't need a chain's own wallet app: one example is an older coin whose wallet no longer runs, or has no build for your machine. blocktools can still turn your key into that chain's addresses and build a sweep transaction offline, for every chain in its table. This page only shows what the repo's recipes run; anything marked not built or untested there is marked the same here.

## 1. Is your chain in the table?

    derive --list-chains

The full table, with which rows can sign, is in [Supported chains](/blocktools/docs/chains). Feathercoin (`ftc`), Peercoin (`ppc`), Namecoin (`nmc`), ReddCoin (`rdd`), Novacoin, Clams, BlackCoin, Primecoin, Quark, Dash, Vertcoin, DigiByte, Monacoin, Ravencoin, Qtum and others are rows.

## 2. Key to addresses (offline, sealed)

From a raw key (`in/key.hex`), on several old chains at once (from recipes/chain-old-coins.md):

    ./blocktools run 'key-to-addresses --chain ppc,nmc,ftc,rdd < /in/key.hex'

From a seed phrase on Qtum (from recipes/chain-qtum.md):

    ./blocktools run 'seed-repair < /in/seed.txt | seed-to-master | derive --chain qtum --count 1'

From an old client's `wallet.dat` (Qtum Core is a Bitcoin Core fork): see [wallet.dat](/blocktools/recipes/input-wallet-dat), then `key-to-addresses --chain qtum`.

## 3. Build and check the sweep (offline)

`tx-build` makes an unsigned sweep from a UTXO list (`{"txid","vout","amount","address"}` per line; an explorer or `utxo-fetch` gives it). Peercoin-style coins (ppc, nvc, clam, rdd) need `--time`:

    ./blocktools run 'tx-build --chain ppc --utxos /in/u-ppc.json --to P9CXqzQyLNguvGoLDeuGx28QZjotMoQcCZ --sweep --fee-rate 5 --time 1792800000 | tx-verify --chain ppc --expect-to P9CXqzQyLNguvGoLDeuGx28QZjotMoQcCZ'

Qtum (fee floor is high; the recipe uses 700 sat/vB):

    ./blocktools run 'tx-build --chain qtum --utxos /in/u-qtum.json --to QMDLoKJqTv5YNaDbHuuEQPwmTFaiaKHJVp --sweep --fee-rate 700 | tx-verify --chain qtum --expect-to QMDLoKJqTv5YNaDbHuuEQPwmTFaiaKHJVp --max-fee 1000000'

## 4. Sign, then broadcast yourself

`tx-sign --chain C` signs ONE transaction after a human reads its summary and types a code on /dev/tty ([goal: sweep](/blocktools/recipes/goal-sweep)). Then broadcast the hex yourself (for Qtum: qtum.info, or `sendrawtransaction` in Qtum Core).

## What the repo says is NOT covered

- `tx-broadcast` covers btc/ltc/doge/eth backends only; for old coins you broadcast the signed hex yourself.
- `recipes/recover.sh` automates sweeps only for btc/ltc/doge/eth; other chains stop after listing addresses (exit 3).
- Qtum smart contracts: contract (OP_CALL/OP_CREATE) outputs and P2PK inputs are not covered, and no Qtum tx built by blocktools has been broadcast yet.
- Potcoin sweep is not built. The Quark tx format is unverified ("test a small amount first").
- Whether each network accepts the result (min relay fee, nTime window) is untested.
- Release binaries are Linux x86_64 only; on macOS, build from source (macOS is not measured).

Sources: blocktools recipes/chain-old-coins.md, recipes/chain-qtum.md, recipes/goal-sweep.md, docs/CHAINS.md, README.
