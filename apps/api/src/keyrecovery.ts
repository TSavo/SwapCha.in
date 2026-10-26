/**
 * Key recovery: step 1 of signing_guide ("do you have the key?").
 * Full playbook returned by MCP tools. Agents have the human run blocktools (https://github.com/TSavo/blocktools) LOCALLY, OFFLINE
 * on the user's own machine. SwapChan never receives seeds, keys, passwords or wallet files;
 * only PUBLIC addresses go to find_money.
 */
import { SITE } from "./onchain.js";

export const KEY_WARNINGS = [
  "NEVER paste a seed phrase, private key, wallet file or password into a chat, an AI prompt, an email, or ANY website, including SwapChan. Nobody legitimate needs it.",
  "Run recovery code on the user's own machine, ideally offline (disconnect networking or use a live USB). Agents: have the human run blocktools (or the listed tool) locally; do not read the secret into your context.",
  "Only PUBLIC addresses leave the machine. Feed those to find_money.",
  "'Wallet recovery services' that DM you, ask for your phrase, or ask for fees up front are scams. Open-source tools (blocktools https://github.com/TSavo/blocktools, btcrecover, Electrum) run locally and need no one else.",
  "Work on a COPY of any wallet file. Once found, move funds to a fresh wallet: an old key that has been typed into a script is no longer pristine.",
];

/** How many addresses to derive per phrase. */
export const GAP_POLICY = {
  perPath: 20,
  heavyUser: 50,
  rule: "Derive GAP addresses on EVERY path below (not just index 0): 20 per path by default, 50+ for heavy users (many accounts, exchanges' deposit habits, Ledger Live with several accounts). If any address near index GAP-1 has history, raise GAP and rerun. Also derive with each BIP39 passphrase candidate the user remembers (blank first). Send ALL of them, labeled with wallet + path, to find_money_batch (up to 500 per batch).",
  example:
    "blocktools derive --preset scan-js: 15 paths x 20 = 300 addresses per passphrase candidate. --index 0..49: 750 (split into 500-line batches).",
};

export const DERIVATION_PATHS = [
  {
    wallet: "MetaMask, Trezor, Trust, Exodus, Rabby (EVM)",
    chain: "evm",
    path: "m/44'/60'/0'/0/{i}",
  },
  { wallet: "Ledger Live (EVM)", chain: "evm", path: "m/44'/60'/{i}'/0/0" },
  { wallet: "Ledger legacy / MEW / MyCrypto (EVM)", chain: "evm", path: "m/44'/60'/0'/{i}" },
  {
    wallet: "Phantom, Solflare, Backpack, Trust, Exodus (Solana)",
    chain: "solana",
    path: "m/44'/501'/{i}'/0'",
  },
  { wallet: "Solflare legacy / Sollet", chain: "solana", path: "m/44'/501'/{i}'" },
  { wallet: "TronLink, Trust (Tron)", chain: "tron", path: "m/44'/195'/0'/0/{i}" },
  { wallet: "Bitcoin legacy P2PKH (1…)", chain: "btc", path: "m/44'/0'/0'/0/{i}" },
  { wallet: "Bitcoin nested SegWit (3…)", chain: "btc", path: "m/49'/0'/0'/0/{i}" },
  {
    wallet: "Bitcoin native SegWit (bc1q…; Exodus, Trezor, Ledger default)",
    chain: "btc",
    path: "m/84'/0'/0'/0/{i}",
  },
  { wallet: "Bitcoin Taproot (bc1p…)", chain: "btc", path: "m/86'/0'/0'/0/{i}" },
  {
    wallet: "Litecoin legacy (L…; Electrum-LTC BIP39, Trezor, Ledger, Exodus)",
    chain: "ltc",
    path: "m/44'/2'/0'/0/{i}",
  },
  {
    wallet: "Litecoin native SegWit (ltc1q…; Trezor, Ledger, Exodus)",
    chain: "ltc",
    path: "m/84'/2'/0'/0/{i}",
  },
  {
    wallet: "Dogecoin (D…; Trezor, Ledger, Exodus, Trust)",
    chain: "doge",
    path: "m/44'/3'/0'/0/{i}",
  },
  {
    wallet: "Bitcoin Cash (Electron Cash BIP39, Exodus, Trezor)",
    chain: "bch",
    path: "m/44'/145'/0'/0/{i}",
  },
  { wallet: "Bitcoin Gold (Trezor, Ledger)", chain: "btg", path: "m/44'/156'/0'/0/{i}" },
  {
    wallet:
      "Exodus: one BIP39 phrase, account 0 on each coin (BTC m/84'/0'/0', ETH m/44'/60'/0'/0/0, LTC m/84'/2'/0', DOGE m/44'/3'/0', SOL m/44'/501'/0'/0'); use index 0 first, then the GAP",
    chain: "multi",
    path: "see the coin rows",
  },
];

/** Pre-2012 Bitcoin keys were often UNCOMPRESSED (WIF starting with 5; bitaddress.org, early Bitcoin-Qt, blockchain.info). The same key gives a different 1… address in compressed form, and fork/same-key coins (BCH, BTG, LTC, DOGE) follow the same rule. */
export const UNCOMPRESSED_KEYS = {
  rule: "Derive BOTH the uncompressed and the compressed address of every old key and send both to find_money. A WIF starting with 5 is uncompressed; K or L is compressed. Paper wallets, brainwallets and wallets made before 2012 are usually uncompressed.",
  offlineCode:
    "key-to-addresses --chain btc < key.txt | redact   # blocktools, offline: prints both the compressed and uncompressed 1... address (and SegWit/Taproot), keys [REDACTED]",
};

/** blocktools: open-source offline key tooling. Every seed/key/keystore step below runs there, not in SwapChan. */
export const BLOCKTOOLS = {
  url: "https://github.com/TSavo/blocktools",
  docs: "https://github.com/TSavo/blocktools/blob/main/recipes/offline-recovery-guide.md",
  install: [
    "git clone https://github.com/TSavo/blocktools && cd blocktools",
    "cargo build --locked --release --workspace   # binaries land in target/release/",
    'export PATH="$PWD/target/release:$PATH"',
  ],
  note: "Build from source while online (no packaged release has been published yet), read the code, then DISCONNECT from the network before any step that reads a seed, key or wallet file. The project's README also describes a sealed Docker wrapper (./blocktools run). Tested on Linux; macOS is untested.",
};

const BT_INSTALL = `# blocktools (open source): ${BLOCKTOOLS.url}
# Install from source while online (no packaged release yet), then go OFFLINE:
#   ${BLOCKTOOLS.install.join("\n#   ")}
# Tested on Linux; macOS is untested. Read the README's safety notes first: it recommends its sealed
# Docker wrapper (./blocktools run) for hostile wallet files; at minimum run these on an OFFLINE machine.`;

const SEED_BT = `${BT_INSTALL}
# Put the phrase in seed.txt ON THE OFFLINE MACHINE (never in chat). Optional: passphrases.txt with
# BIP39 passphrase ("25th word") candidates, one per line; the empty passphrase is always tried first.
seed-to-master --passphrase-file passphrases.txt < seed.txt | derive --preset scan-js --address-list > addresses.txt
# No passphrase candidates:  seed-to-master < seed.txt | derive --preset scan-js --address-list > addresses.txt
# --preset scan-js = the 15 wallet paths in derivationPaths x 20 addresses (300 per passphrase candidate).
# Heavy users: add --index 0..49 (50 per path). Preview the plan without any secret: derive --explain --preset scan-js
# addresses.txt has one "wallet label<TAB>path<TAB>address" line per address: PUBLIC data only, no keys.
# Delete seed.txt / passphrases.txt, then paste ONLY addresses.txt into find_money_batch
# (max 500 per batch; split larger files: split -l 500 addresses.txt part-).`;

const MISSING_WORD = `${BT_INSTALL}
# Missing or mistyped word. Write the phrase to seed.txt with "?" for each unknown word (one "?" = 2048 tries,
# seconds; one word short = tried at every position; swapped adjacent pairs are tried too).
# targets.txt: an address you know this wallet used (one per line), so only the real phrase prints.
seed-repair < seed.txt | seed-to-master | derive --preset scan-js --match targets.txt --address-list
# No known address? Drop --match and send the address list to find_money_batch (one block per checksum-valid candidate).
# Two "?" are searched under a budget and may miss. Electrum 2.x seeds: see recipes/input-seed-phrase.md in blocktools.`;

const PASSPHRASE = `${BT_INSTALL}
# BIP39 passphrase ("25th word") forgotten. passphrases.txt = candidates from THEIR hints, one per line
# (pets, years, keyboard patterns) - never a public dump. targets.txt = an address that wallet used.
seed-to-master --passphrase-file passphrases.txt < seed.txt | derive --preset scan-js --match targets.txt --address-list
# A hit prints the label, the path with " [passphrase #N]" (N = line in passphrases.txt) and the address.
# Typo-style brute force of passphrases is not in blocktools: use btcrecover offline
#   (git clone https://github.com/3rdIteration/btcrecover; --bip39-passphrase --passphrase-typos 2).
# Feed matching PUBLIC addresses to find_money. Keys stay local.`;

const KEYSTORE_V3 = `${BT_INSTALL}
# Ethereum keystore v3 (geth / Mist / MyEtherWallet / Parity / MyCrypto UTC--....json). Work on a COPY.
# keystore.pw = the password in a local file (never on the command line, never in chat).
read-file keystore.pw UTC--copy.json | keystore-open | redact
# Prints {"address":"0x...","private_key":"[REDACTED]",...}: ONLY the address goes to find_money.
# Forgotten password? btcrecover with a passwordlist built from THEIR hints (not in blocktools):
#   python btcrecover.py --wallet UTC--copy.json --passwordlist passwordlist.txt --typos 2
# Never paste the JSON or the password into chat.`;

const PRESALE = `# Ethereum 2014-15 presale wallet (CrowdSale JSON from ethereum.org).
# File has "encseed", "ethaddr", "bkraddress", "email", "bkp". Password was chosen at purchase.
# Tool: https://github.com/ethereum/pyethsaletool  (or btcrecover --wallet-type ethereum_presale)
# (blocktools does not open presale wallets yet, so this branch keeps these tools.)
# Offline:
#   python pyethsaletool.py getprivkey wallet.json
# It prompts for the password. On success it prints the private key and address.
# Password forgotten? btcrecover:
#   python btcrecover.py --wallet wallet.json --wallet-type ethereum_presale --passwordlist passwordlist.txt --typos 2
# Page: ${SITE}/recover/ethereum-presale-wallet-2015
# Once you have the address, find_money. Sign any recovery txs in a local wallet with human sign-off.`;

const ELECTRUM = `# Electrum seed (old Bitcoin / Electrum wallets). Electrum seeds are NOT BIP39.
# Install Electrum offline (official release only). File -> New/Restore -> "I already have a seed".
# Paste the seed ONLY into Electrum on an air-gapped machine. It restores addresses.
# For a forgotten Electrum seed password / partial seed: btcrecover seedrecover.py
#   python seedrecover.py --electrum2 --addrs <known> --mnemonic-length 12 --typos 2
# Export addresses (public) and feed them to find_money for BTC balances / UTXOs.`;

const WALLET_DAT = `# Bitcoin Core wallet.dat (pre-descriptor era).
# NEVER open the live file; work on a COPY. Prefer an offline machine.
# Forgotten passphrase / encrypted wallet.dat: btcrecover is the standard tool.
#   python btcrecover.py --wallet wallet.dat --passwordlist passwordlist.txt --typos 2
# Once unlocked, dump addresses with bitcoin-cli / pywallet (public only), then find_money.
# Descriptor wallets (Bitcoin Core 0.21+) use descriptors; export those, don't ship the .dat.`;

const BLOCKCHAIN_INFO = `# Blockchain.info / blockchain.com legacy HD wallets (pre-2019 "main password" + backup phrase).
# The 2nd-password encrypted payload needs the main password. Prefer the official wallet recovery
# (login + mnemonic) on a trusted machine. For a forgotten main password against a known backup:
# btcrecover supports blockchain.com wallets:
#   python btcrecover.py --wallet blockchain.com.wallet.aes.json --passwordlist passwordlist.txt
# Never upload the wallet file or the mnemonic to a third-party "recovery service".`;

const HARDWARE = `# Hardware wallet (Ledger / Trezor / BitBox / Coldcard): the seed NEVER leaves the device.
# 1. Confirm the device firmware is genuine (vendor site).
# 2. Open the vendor app (Ledger Live, Trezor Suite) or a trusted companion (Sparrow, Electrum).
# 3. Export / display the PUBLIC addresses for each account/path you used historically
#    (Ledger Live vs Ledger legacy paths differ - scan both; see derivationPaths).
# 4. Feed those PUBLIC addresses to find_money. Sign recovery txs on the device with human confirm.
# If the device is lost but you have the BIP39 recovery sheet: treat it as a seed-phrase recovery
# on a new device or an air-gapped offline machine - never type the sheet into a website.`;

export type Situation =
  | "full"
  | "seed-phrase"
  | "missing-word"
  | "passphrase"
  | "keystore"
  | "presale"
  | "electrum"
  | "wallet-dat"
  | "blockchain-info"
  | "hardware"
  | "raw-key"
  | "password-hints";

export interface RecoveryBranch {
  pointers?: string[];
  id: Situation | string;
  title: string;
  when: string;
  steps: string[];
  code?: string;
  tools?: string[];
  page?: string;
}

const RAW_KEY = `${BT_INSTALL}
# You already have a private key (0x... hex) or a WIF. Do NOT paste it into chat.
# key.txt = the key in a local file on the offline machine.
key-to-addresses < key.txt | redact
# Prints the PUBLIC addresses on every chain (Bitcoin: compressed AND uncompressed P2PKH, SegWit, Taproot;
# EVM; and the other supported chains), keys shown as [REDACTED]. Limit with --chain btc,eth.
# Then find_money on those addresses. After moving funds, discard the old key.`;

export const RECOVERY_BRANCHES: RecoveryBranch[] = [
  {
    id: "seed-phrase",
    title: "BIP39 seed phrase (12/15/18/21/24 words)",
    when: "User has a complete BIP39 mnemonic from MetaMask, Trust, Exodus, Ledger sheet, Trezor, Phantom, Solflare, TronLink, etc.",
    steps: [
      "Install blocktools (https://github.com/TSavo/blocktools) on THEIR machine from source, then disconnect networking (or use a live USB). Do not ask them to paste the phrase into chat; they put it in a local seed.txt.",
      "They run: seed-to-master --passphrase-file passphrases.txt < seed.txt | derive --preset scan-js --address-list > addresses.txt",
      "That derives 20 addresses on each of the 15 wallet paths (EVM MetaMask/Trezor/Trust/Exodus, Ledger Live, Ledger legacy, TronLink, Phantom, Solflare legacy, BTC 44/49/84/86, LTC 44/84, DOGE, BCH, BTG; --index 0..49 for heavy users) for the blank passphrase and each candidate, and writes labeled PUBLIC addresses only (label<TAB>path<TAB>address) to addresses.txt.",
      "Send the WHOLE addresses.txt to find_money_batch (it keeps the labels; up to 500 per batch). Do not send only index 0: forgotten money is usually on account 2, 3 or a Ledger Live account.",
      "If any address near index GAP-1 has activity, rerun with a bigger GAP. For any finding: verify_tx -> human signs locally -> broadcast_tx.",
      "After funds move, generate a NEW wallet for ongoing use; the typed seed is no longer pristine.",
    ],
    code: SEED_BT,
    tools: ["blocktools (seed-to-master, derive)"],
    page: `${SITE}/recover/seed-phrase`,
  },
  {
    id: "missing-word",
    title: "Missing, mistyped or out-of-order BIP39 word",
    when: "User has most of a phrase but one (or a few) words are unknown, smudged, or possibly swapped.",
    steps: [
      "Put '?' in each unknown slot. One unknown word is ~2048 checksum-filtered tries (seconds).",
      "Two unknown words is millions of tries (blocktools seed-repair budgets it); prefer a known address to filter, or use btcrecover with --typos.",
      "Offline: seed-repair < seed.txt | seed-to-master | derive --preset scan-js --match targets.txt --address-list. Only checksum-valid candidates are derived, and --match prints only PUBLIC addresses matching a known one.",
      "Feed matching addresses to find_money.",
    ],
    code: MISSING_WORD,
    tools: ["blocktools (seed-repair, seed-to-master, derive)", "btcrecover (seedrecover.py)"],
    page: `${SITE}/recover/seed-phrase`,
  },
  {
    id: "passphrase",
    title: "BIP39 passphrase (25th word) forgotten",
    when: "The 12/24 words are known, but the optional BIP39 passphrase is not, so derived addresses don't match what the user remembers.",
    steps: [
      "Build passwordlist.txt from THEIR personal hints only (pets, years, keyboard walks, old passwords they volunteer). Never use a public dump.",
      "Offline: seed-to-master --passphrase-file passphrases.txt < seed.txt | derive --preset scan-js --match targets.txt --address-list (targets.txt = a known address from that wallet).",
      "For typo-style brute force of a passphrase, use btcrecover offline (blocktools does not do this).",
      "On match, derive the full address list for that passphrase and call find_money_batch.",
    ],
    code: PASSPHRASE,
    tools: ["blocktools (seed-to-master, derive)", "btcrecover"],
    page: `${SITE}/recover/seed-phrase`,
  },
  {
    id: "keystore",
    title: "Ethereum keystore v3 (geth / Mist / MEW / Parity / MyCrypto)",
    when: "User has a UTC--…json or a 'Keystore File' download, and (hopefully) the password.",
    steps: [
      "Work on a COPY of the file. Never upload it.",
      "If the password is known: decrypt offline with blocktools: read-file keystore.pw UTC--copy.json | keystore-open | redact (prints the address, key [REDACTED]); find_money.",
      "If the password is forgotten: btcrecover with a passwordlist built from their hints + --typos.",
      "Import the key into a local wallet only long enough to sign recovery txs (verify_tx first, human sign-off).",
    ],
    code: KEYSTORE_V3,
    tools: ["blocktools (keystore-open, redact)", "btcrecover"],
    page: `${SITE}/recover/keystore`,
  },
  {
    id: "presale",
    title: "Ethereum 2014-15 Crowdsale / presale wallet",
    when: "User bought ETH in the 2014 crowdsale and still has the wallet JSON emailed / downloaded then (encseed + ethaddr).",
    steps: [
      "Locate the original JSON (email attachment, old backup). Work on a COPY.",
      "Decrypt offline with pyethsaletool or btcrecover --wallet-type ethereum_presale.",
      "Print the address -> find_money. Sign any recovery / sweep txs locally with human sign-off.",
      "Many presale wallets sit untouched with ETH + airdrops + stuck DeFi from later use of the same key.",
    ],
    code: PRESALE,
    tools: ["pyethsaletool", "btcrecover"],
    page: `${SITE}/recover/ethereum-presale-wallet-2015`,
  },
  {
    id: "electrum",
    title: "Electrum seed (Bitcoin)",
    when: "User has an Electrum seed (not BIP39) or an Electrum wallet file.",
    steps: [
      "Restore offline in official Electrum. Electrum seeds use a different checksum than BIP39.",
      "For partial / password-protected seeds use btcrecover seedrecover.py --electrum2.",
      "Export addresses (public) -> find_money for BTC.",
    ],
    code: ELECTRUM,
    tools: ["Electrum", "btcrecover", "Electrum-LTC", "Electron Cash"],
    pointers: [
      "Electrum 1.x 'old' seeds are 12 words from a 1626-word list (not BIP39); Electrum 2.0+ seeds carry a version prefix (standard / segwit / 2fa). Restore both kinds in Electrum with 'I already have a seed'; pick 'Options -> BIP39' only for real BIP39 phrases.",
      "The same Electrum seed restores in Electrum-LTC (Litecoin) and Electron Cash (BCH fork coins), each offline; export their PUBLIC addresses to find_money too.",
      "Electrum wallet files (default_wallet) with a forgotten password: btcrecover --wallet default_wallet.",
    ],
  },
  {
    id: "wallet-dat",
    title: "Bitcoin Core wallet.dat",
    when: "User has a wallet.dat from Bitcoin Core (especially pre-descriptor).",
    steps: [
      "Copy the file; never open the live wallet on an online machine while recovering.",
      "If encrypted and password forgotten: btcrecover --wallet wallet.dat with their passwordlist.",
      "Dump addresses with bitcoin-cli / pywallet; public addresses only -> find_money.",
    ],
    code: WALLET_DAT,
    tools: ["btcrecover", "bitcoin-cli", "pywallet"],
  },
  {
    id: "blockchain-info",
    title: "Blockchain.info / blockchain.com legacy wallet",
    when: "User has a pre-2019 blockchain.info wallet backup or remembers the mnemonic + main password pattern.",
    steps: [
      "Prefer official login + mnemonic on a trusted machine.",
      "Forgotten main password against a known backup file: btcrecover supports the format.",
      "Never send the backup or mnemonic to a third-party recovery service.",
    ],
    code: BLOCKCHAIN_INFO,
    tools: ["btcrecover", "blockchain.com official wallet"],
  },
  {
    id: "hardware",
    title: "Hardware wallet (seed stays on device)",
    when: "User still has the Ledger / Trezor / BitBox / Coldcard, or has the BIP39 recovery sheet for a lost device.",
    steps: [
      "If device works: export PUBLIC addresses via vendor app (scan Ledger Live AND legacy paths).",
      "find_money on those addresses; sign recovery txs on-device with human confirm each time.",
      "If device is lost but sheet exists: treat as seed-phrase recovery on a NEW device or air-gapped machine. Never type the sheet into a website.",
    ],
    code: HARDWARE,
    tools: ["Ledger Live", "Trezor Suite", "Sparrow", "Electrum"],
  },
  {
    id: "raw-key",
    title: "Raw private key or WIF already in hand",
    when: "User has a 0x… hex key or a WIF string written down.",
    steps: [
      "Do not paste it into chat. Put it in a local key.txt and run blocktools offline: key-to-addresses < key.txt | redact (public addresses on every chain, compressed and uncompressed BTC).",
      "find_money on the address. Sweep to a fresh wallet after recovery.",
    ],
    code: RAW_KEY,
    tools: [
      "blocktools (key-to-addresses, redact)",
      "Rabby / MetaMask import",
      "Electrum / Sparrow",
    ],
  },
  {
    id: "password-hints",
    title: "Password / passphrase guessing from the user's own hints",
    when: "Any encrypted wallet (keystore, wallet.dat, BIP39 passphrase, blockchain.info) where the user remembers fragments, patterns or old passwords.",
    steps: [
      "Interview the human for THEIR tokens only: pet names, years, keyboard patterns, old passwords they volunteer, site-specific variants. Write passwordlist.txt locally.",
      "Never download a public password dump into this flow.",
      "Run btcrecover with --passwordlist passwordlist.txt and modest --typos (1-2). Add --typos-capslock / --typos-swap for common mistakes.",
      "On success, continue into the matching branch above (keystore / passphrase / wallet.dat / …).",
    ],
    code: `# Example passwordlist.txt (built from THEIR hints - illustrative only):
# Fluffy2015!
# flufFy2015
# Fluffy2015
# Then: python btcrecover.py --wallet <file> --passwordlist passwordlist.txt --typos 2 --typos-capslock`,
    tools: ["btcrecover"],
  },
];

const DECISION_TREE = [
  { have: "Complete BIP39 12/24 words", go: "seed-phrase" },
  { have: "Most of a BIP39 phrase, one/few words missing or doubtful", go: "missing-word" },
  { have: "BIP39 words work in a tool but addresses don't match (passphrase?)", go: "passphrase" },
  { have: "UTC--…json / MEW keystore file", go: "keystore" },
  { have: "2014-15 ethereum.org crowdsale JSON (encseed)", go: "presale" },
  { have: "Electrum seed or Electrum wallet file", go: "electrum" },
  { have: "Bitcoin Core wallet.dat", go: "wallet-dat" },
  { have: "Old blockchain.info backup", go: "blockchain-info" },
  { have: "Ledger / Trezor / BitBox still in hand (or its BIP39 sheet)", go: "hardware" },
  { have: "Raw 0x private key or WIF", go: "raw-key" },
  { have: "Encrypted anything + password fragments / hints", go: "password-hints" },
];

/** Full playbook (or one branch). Returned verbatim by MCP signing_guide / recovery_guide. */
export function recoveryGuide(situation: Situation | string = "full") {
  const s = (situation || "full").toLowerCase();
  const branches =
    s === "full"
      ? RECOVERY_BRANCHES
      : RECOVERY_BRANCHES.filter((b) => b.id === s || b.id.startsWith(s));
  if (!branches.length) {
    return {
      error: `unknown situation "${situation}"`,
      known: RECOVERY_BRANCHES.map((b) => b.id),
      decisionTree: DECISION_TREE,
      warnings: KEY_WARNINGS,
    };
  }
  return {
    role: "step 1 of signing_guide: do you have the key?",
    principle:
      "Recover keys LOCALLY and OFFLINE on the user's machine. SwapChan and the agent never see seeds, keys, passwords or wallet files. Only PUBLIC addresses are sent to find_money.",
    warnings: KEY_WARNINGS,
    decisionTree: DECISION_TREE,
    blocktools: BLOCKTOOLS,
    derivationPaths: DERIVATION_PATHS,
    uncompressedKeys: UNCOMPRESSED_KEYS,
    gapPolicy: GAP_POLICY,
    situations: branches,
    nextSteps: [
      "find_money_batch with EVERY labeled public address in addresses.txt (blocktools derive --address-list) (GAP per path, all paths, all passphrase candidates); find_money for a single address",
      "verify_tx on every unsigned recovery / swap tx",
      "human reviews the verify_tx summary and signs in THEIR wallet (hardware preferred)",
      "broadcast_tx (optional; Flashbots Protect on Ethereum mainnet) then tx_status",
    ],
    pages: {
      hub: `${SITE}/recover`,
      seedPhrase: `${SITE}/recover/seed-phrase`,
      keystore: `${SITE}/recover/keystore`,
      ethereumPresale: `${SITE}/recover/ethereum-presale-wallet-2015`,
      signingGuide: `${SITE}/agents/secure-signing`,
    },
    trust:
      "SwapChan never receives secrets, never signs, never holds keys or funds. This guide is information plus blocktools commands the human runs locally.",
  };
}
