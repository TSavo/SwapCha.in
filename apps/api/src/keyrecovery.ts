/**
 * Key recovery: step 1 of signing_guide ("do you have the key?").
 * Full playbook returned by MCP tools. Agents run reference code LOCALLY, OFFLINE
 * on the user's own machine. SwapChan never receives seeds, keys, passwords or wallet files;
 * only PUBLIC addresses go to find_money.
 */
import { SITE } from "./onchain.js";

export const KEY_WARNINGS = [
  "NEVER paste a seed phrase, private key, wallet file or password into a chat, an AI prompt, an email, or ANY website, including SwapChan. Nobody legitimate needs it.",
  "Run recovery code on the user's own machine, ideally offline (disconnect networking or use a live USB). Agents: write the script to a local file and have the human run it; do not read the secret into your context.",
  "Only PUBLIC addresses leave the machine. Feed those to find_money.",
  "'Wallet recovery services' that DM you, ask for your phrase, or ask for fees up front are scams. Open-source tools (btcrecover, Ian Coleman BIP39 offline HTML, Electrum) run locally and need no one else.",
  "Work on a COPY of any wallet file. Once found, move funds to a fresh wallet: an old key that has been typed into a script is no longer pristine.",
];

/** How many addresses to derive per phrase. */
export const GAP_POLICY = {
  perPath: 20,
  heavyUser: 50,
  rule: "Derive GAP addresses on EVERY path below (not just index 0): 20 per path by default, 50+ for heavy users (many accounts, exchanges' deposit habits, Ledger Live with several accounts). If any address near index GAP-1 has history, raise GAP and rerun. Also derive with each BIP39 passphrase candidate the user remembers (blank first). Send ALL of them, labeled with wallet + path, to find_money_batch (up to 500 per batch).",
  example: "GAP=20, one passphrase: 10 paths x 20 = 200 addresses. GAP=50: 500 (one full batch).",
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
];

/** Offline multi-chain deriver: every path below, GAP addresses each, optional passphrase candidates; prints labeled PUBLIC addresses for find_money_batch. Verified against the public "abandon x11 about" test vectors. */
export const SCAN_JS = String.raw`// npm i @scure/bip39 @scure/bip32 @scure/btc-signer @noble/hashes @noble/curves @scure/base   (then go OFFLINE)
// Run locally:  node scan.mjs  [GAP=20|50 env]  [PASSPHRASES=file.txt env, one candidate per line]
// Prompts for the phrase, prints LABELED PUBLIC addresses only, one per line, ready to paste into find_money_batch.
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base58check } from "@scure/base";
import * as btc from "@scure/btc-signer";
import { readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline/promises";

const GAP = Number(process.env.GAP || 20); // 20 per path; 50+ for heavy users
const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
const phrase = (process.env.PHRASE || (await rl.question("phrase (stays on this machine): "))).trim().toLowerCase().split(/\s+/).join(" ");
rl.close();
if (!validateMnemonic(phrase, wordlist)) throw new Error("checksum fails: see the missing-word branch");
const passes = [""].concat(process.env.PASSPHRASES ? readFileSync(process.env.PASSPHRASES, "utf8").split("\n").filter(Boolean) : []);

const evm = (k) => {
  const pub = secp256k1.getPublicKey(k.privateKey, false).slice(1);
  const h = Buffer.from(keccak_256(pub)).toString("hex").slice(-40);
  const hh = Buffer.from(keccak_256(new TextEncoder().encode(h))).toString("hex");
  return "0x" + [...h].map((c, i) => (parseInt(hh[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
};
const tron = (k) => base58check(sha256).encode(Uint8Array.from(Buffer.from("41" + evm(k).slice(2).toLowerCase(), "hex")));
// Solana: SLIP-10 ed25519, all segments hardened
const slip10 = (seed, path) => {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let key = I.slice(0, 32), chain = I.slice(32);
  for (const seg of path.split("/").slice(1)) {
    const idx = (parseInt(seg, 10) | 0x80000000) >>> 0;
    const data = new Uint8Array(37); data.set(key, 1);
    new DataView(data.buffer).setUint32(33, idx);
    I = hmac(sha512, chain, data); key = I.slice(0, 32); chain = I.slice(32);
  }
  return base58.encode(ed25519.getPublicKey(key));
};
const BTC = {
  44: (pk) => btc.p2pkh(pk).address,
  49: (pk) => btc.p2sh(btc.p2wpkh(pk)).address,
  84: (pk) => btc.p2wpkh(pk).address,
  86: (pk) => btc.p2tr(pk.slice(1)).address,
};
const PATHS = [
  ["MetaMask/Trezor/Trust/Exodus/Rabby EVM", "m/44'/60'/0'/0/{i}", "evm"],
  ["Ledger Live EVM", "m/44'/60'/{i}'/0/0", "evm"],
  ["Ledger legacy/MEW EVM", "m/44'/60'/0'/{i}", "evm"],
  ["TronLink/Trust Tron", "m/44'/195'/0'/0/{i}", "tron"],
  ["Phantom/Solflare/Backpack/Trust/Exodus Solana", "m/44'/501'/{i}'/0'", "sol"],
  ["Solflare legacy/Sollet Solana", "m/44'/501'/{i}'", "sol"],
  ["BTC legacy (1...)", "m/44'/0'/0'/0/{i}", "btc44"],
  ["BTC nested SegWit (3...)", "m/49'/0'/0'/0/{i}", "btc49"],
  ["BTC native SegWit (bc1q...) Exodus/Trezor/Ledger", "m/84'/0'/0'/0/{i}", "btc84"],
  ["BTC Taproot (bc1p...)", "m/86'/0'/0'/0/{i}", "btc86"],
];
const out = [];
for (const [pi, pass] of passes.entries()) {
  const seed = mnemonicToSeedSync(phrase, pass);
  const root = HDKey.fromMasterSeed(seed);
  const tag = pi ? " [passphrase #" + pi + "]" : "";
  for (const [name, tpl, kind] of PATHS)
    for (let i = 0; i < GAP; i++) {
      const p = tpl.replace("{i}", String(i));
      const a = kind === "sol" ? slip10(seed, p) : kind === "evm" ? evm(root.derive(p)) : kind === "tron" ? tron(root.derive(p)) : BTC[kind.slice(3)](root.derive(p).publicKey);
      out.push(name + " " + p + tag + " " + a);
    }
}
writeFileSync("addresses.txt", out.join("\n") + "\n");
console.log(out.join("\n"));
console.error("\n" + out.length + " public addresses (GAP=" + GAP + ", " + passes.length + " passphrase candidate(s)) -> addresses.txt. Paste ONLY this file into find_money_batch (max 500 per batch; split if larger). If any address near index GAP-1 shows activity, rerun with a bigger GAP.");`;

const SCAN_PY = `# pip install bip_utils   (then go OFFLINE). Covers EVM, Solana, Tron and all 4 BTC script types.
from getpass import getpass
from bip_utils import (Bip39SeedGenerator, Bip44, Bip49, Bip84, Bip86, Bip44Coins, Bip49Coins,
                       Bip84Coins, Bip86Coins, Bip44Changes)
seed = Bip39SeedGenerator(getpass("phrase: ")).Generate(getpass("passphrase (blank if none): "))
def scan(ctx, n=5):
    acc = ctx.Purpose().Coin().Account(0).Change(Bip44Changes.CHAIN_EXT)
    return [acc.AddressIndex(i).PublicKey().ToAddress() for i in range(n)]
print("ETH ", scan(Bip44.FromSeed(seed, Bip44Coins.ETHEREUM)))
print("TRON", scan(Bip44.FromSeed(seed, Bip44Coins.TRON)))
print("SOL ", [Bip44.FromSeed(seed, Bip44Coins.SOLANA).Purpose().Coin().Account(i).Change(Bip44Changes.CHAIN_EXT).PublicKey().ToAddress() for i in range(5)])
print("BTC44", scan(Bip44.FromSeed(seed, Bip44Coins.BITCOIN)))
print("BTC49", scan(Bip49.FromSeed(seed, Bip49Coins.BITCOIN)))
print("BTC84", scan(Bip84.FromSeed(seed, Bip84Coins.BITCOIN)))
print("BTC86", scan(Bip86.FromSeed(seed, Bip86Coins.BITCOIN)))
# Public addresses only -> find_money.`;

const MISSING_WORD = `// Missing or mistyped word: the last word carries a checksum, so most candidates fail validation.
// Put "?" for an unknown word (or the word you doubt). One unknown = 2048 tries, seconds.
import { validateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { privateKeyToAddress } from "viem/accounts"; import { toHex } from "viem";
const words = process.env.PHRASE.split(" "); // set in the local shell, not in chat
const known = (process.env.KNOWN_ADDRESS || "").toLowerCase(); // optional: an address you know you used
const slots = words.map((w, i) => (w === "?" ? i : -1)).filter((i) => i >= 0);
const tryAll = (ws, k) => { if (k === slots.length) { const m = ws.join(" ");
  if (!validateMnemonic(m, wordlist)) return;
  const a = privateKeyToAddress(toHex(HDKey.fromMasterSeed(mnemonicToSeedSync(m)).derive("m/44'/60'/0'/0/0").privateKey));
  if (!known || a.toLowerCase() === known) console.log("candidate address", a); return; }
  for (const w of wordlist) { ws[slots[k]] = w; tryAll(ws, k + 1); } };
tryAll([...words], 0);
// For swapped/mistyped words use btcrecover: python seedrecover.py --mnemonic-length 12 --addrs <known> --typos 2`;

const PASSPHRASE = `# BIP39 passphrase ("25th word"): common when a user set one and forgot it.
# Install btcrecover offline: git clone https://github.com/3rdIteration/btcrecover
# Build a passwordlist.txt from THEIR hints (pets, years, keyboard patterns) - never from a public dump.
python btcrecover.py --wallet ethereum_bip39 --addrs <known_address> --addr-limit 5 \\
  --mnemonic-prompt --passphrase-listfile passwordlist.txt --bip39-passphrase
# Or brute short patterns: --passphrase-typos 2 --passphrase-min-typos 0 --passphrase-typos-capslock
# When it finds a match it prints the address. Feed that address to find_money. Keys stay local.`;

const KEYSTORE_V3 = `# Ethereum keystore v3 (geth / Mist / MyEtherWallet / Parity / MyCrypto JSON).
# File looks like: {"crypto":{"cipher":"aes-128-ctr","kdf":"scrypt",...},"address":"...","version":3}
# Offline (pip install eth-account):
from getpass import getpass
from eth_account import Account
import json, pathlib
ks = json.loads(pathlib.Path("UTC--….json").read_text())  # a COPY of the file
acct = Account.from_key(Account.decrypt(ks, getpass("password: ")))
print("address", acct.address)  # ONLY this goes to find_money
# Forget password? Use btcrecover with a passwordlist built from THEIR hints:
# python btcrecover.py --wallet UTC--….json --passwordlist passwordlist.txt --typos 2
# Never paste the JSON or the password into chat.`;

const PRESALE = `# Ethereum 2014-15 presale wallet (CrowdSale JSON from ethereum.org).
# File has "encseed", "ethaddr", "bkraddress", "email", "bkp". Password was chosen at purchase.
# Tool: https://github.com/ethereum/pyethsaletool  (or btcrecover --wallet-type ethereum_presale)
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

const RAW_KEY = `# You already have a private key (0x… hex) or a WIF.
# Do NOT paste it into chat. Import it into a local wallet (Rabby / MetaMask "import account",
# Electrum, Sparrow) on your machine, or use a one-shot offline script:
#   from eth_account import Account; print(Account.from_key(open("key.txt").read().strip()).address)
# Then find_money on that address. After moving funds, discard the old key.`;

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
  id: Situation | string;
  title: string;
  when: string;
  steps: string[];
  code?: string;
  tools?: string[];
  page?: string;
}

export const RECOVERY_BRANCHES: RecoveryBranch[] = [
  {
    id: "seed-phrase",
    title: "BIP39 seed phrase (12/15/18/21/24 words)",
    when: "User has a complete BIP39 mnemonic from MetaMask, Trust, Exodus, Ledger sheet, Trezor, Phantom, Solflare, TronLink, etc.",
    steps: [
      "Confirm the human will run the script on THEIR machine. Write scan.mjs or scan.py to disk; do not ask them to paste the phrase into chat.",
      "Have them disconnect networking (or use a live USB), run the script, enter the phrase at the local prompt.",
      "Script derives GAP addresses (20 per path; GAP=50 for heavy users) on all 10 wallet paths (MetaMask/Trezor/Trust/Exodus EVM, Ledger Live, Ledger legacy, TronLink, Phantom, Solflare legacy, BTC 44/49/84/86) and for each passphrase candidate (PASSPHRASES=file), and writes labeled PUBLIC addresses to addresses.txt.",
      "Send the WHOLE addresses.txt to find_money_batch (it keeps the labels; up to 500 per batch). Do not send only index 0: forgotten money is usually on account 2, 3 or a Ledger Live account.",
      "If any address near index GAP-1 has activity, rerun with a bigger GAP. For any finding: verify_tx -> human signs locally -> broadcast_tx.",
      "After funds move, generate a NEW wallet for ongoing use; the typed seed is no longer pristine.",
    ],
    code: `${SCAN_JS}\n\n# --- or Python (multi-chain) ---\n${SCAN_PY}`,
    tools: ["@scure/bip39", "@scure/bip32", "viem", "bip_utils"],
    page: `${SITE}/recover/seed-phrase`,
  },
  {
    id: "missing-word",
    title: "Missing, mistyped or out-of-order BIP39 word",
    when: "User has most of a phrase but one (or a few) words are unknown, smudged, or possibly swapped.",
    steps: [
      "Put '?' in each unknown slot. One unknown word is ~2048 checksum-filtered tries (seconds).",
      "Two unknown words is millions of tries; prefer a known address to filter, or use btcrecover with --typos.",
      "Run the script offline. It only prints candidate PUBLIC addresses that pass the BIP39 checksum (and match KNOWN_ADDRESS if set).",
      "Feed matching addresses to find_money.",
    ],
    code: MISSING_WORD,
    tools: ["@scure/bip39", "btcrecover (seedrecover.py)"],
    page: `${SITE}/recover/seed-phrase`,
  },
  {
    id: "passphrase",
    title: "BIP39 passphrase (25th word) forgotten",
    when: "The 12/24 words are known, but the optional BIP39 passphrase is not, so derived addresses don't match what the user remembers.",
    steps: [
      "Build passwordlist.txt from THEIR personal hints only (pets, years, keyboard walks, old passwords they volunteer). Never use a public dump.",
      "Run btcrecover offline against a known address from that wallet.",
      "On match, derive addresses and call find_money.",
    ],
    code: PASSPHRASE,
    tools: ["btcrecover"],
    page: `${SITE}/recover/seed-phrase`,
  },
  {
    id: "keystore",
    title: "Ethereum keystore v3 (geth / Mist / MEW / Parity / MyCrypto)",
    when: "User has a UTC--…json or a 'Keystore File' download, and (hopefully) the password.",
    steps: [
      "Work on a COPY of the file. Never upload it.",
      "If the password is known: decrypt offline with eth-account; print the address; find_money.",
      "If the password is forgotten: btcrecover with a passwordlist built from their hints + --typos.",
      "Import the key into a local wallet only long enough to sign recovery txs (verify_tx first, human sign-off).",
    ],
    code: KEYSTORE_V3,
    tools: ["eth-account", "btcrecover"],
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
    tools: ["Electrum", "btcrecover"],
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
      "Do not paste it into chat. Import into a local wallet or derive the address with a one-shot offline script.",
      "find_money on the address. Sweep to a fresh wallet after recovery.",
    ],
    code: RAW_KEY,
    tools: ["eth-account", "Rabby / MetaMask import", "Electrum / Sparrow"],
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
    derivationPaths: DERIVATION_PATHS,
    gapPolicy: GAP_POLICY,
    situations: branches,
    nextSteps: [
      "find_money_batch with EVERY labeled public address the local script printed (GAP per path, all paths, all passphrase candidates); find_money for a single address",
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
      "SwapChan never receives secrets, never signs, never holds keys or funds. This guide is information plus reference code the human runs locally.",
  };
}
