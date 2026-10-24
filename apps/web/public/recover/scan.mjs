// npm i @scure/bip39 @scure/bip32 @scure/btc-signer @noble/hashes @noble/curves @scure/base   (then go OFFLINE)
// Run locally:  node scan.mjs  [GAP=20|50 env]  [PASSPHRASES=file.txt env, one candidate per line]
// Prompts for the phrase, prints LABELED PUBLIC addresses only, one per line, ready to paste into find_money_batch.

import { readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58, base58check } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as btc from "@scure/btc-signer";

const GAP = Number(process.env.GAP || 20); // 20 per path; 50+ for heavy users
const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
const phrase = (process.env.PHRASE || (await rl.question("phrase (stays on this machine): ")))
  .trim()
  .toLowerCase()
  .split(/\s+/)
  .join(" ");
rl.close();
if (!validateMnemonic(phrase, wordlist))
  throw new Error("checksum fails: see the missing-word branch");
const passes = [""].concat(
  process.env.PASSPHRASES
    ? readFileSync(process.env.PASSPHRASES, "utf8").split("\n").filter(Boolean)
    : [],
);

const evm = (k) => {
  const pub = secp256k1.getPublicKey(k.privateKey, false).slice(1);
  const h = Buffer.from(keccak_256(pub)).toString("hex").slice(-40);
  const hh = Buffer.from(keccak_256(new TextEncoder().encode(h))).toString("hex");
  return "0x" + [...h].map((c, i) => (parseInt(hh[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
};
const tron = (k) =>
  base58check(sha256).encode(
    Uint8Array.from(Buffer.from("41" + evm(k).slice(2).toLowerCase(), "hex")),
  );
// Solana: SLIP-10 ed25519, all segments hardened
const slip10 = (seed, path) => {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let key = I.slice(0, 32),
    chain = I.slice(32);
  for (const seg of path.split("/").slice(1)) {
    const idx = (parseInt(seg, 10) | 0x80000000) >>> 0;
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, idx);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
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
      const a =
        kind === "sol"
          ? slip10(seed, p)
          : kind === "evm"
            ? evm(root.derive(p))
            : kind === "tron"
              ? tron(root.derive(p))
              : BTC[kind.slice(3)](root.derive(p).publicKey);
      out.push(name + " " + p + tag + " " + a);
    }
}
writeFileSync("addresses.txt", out.join("\n") + "\n");
console.log(out.join("\n"));
console.error(
  "\n" +
    out.length +
    " public addresses (GAP=" +
    GAP +
    ", " +
    passes.length +
    " passphrase candidate(s)) -> addresses.txt. Paste ONLY this file into find_money_batch (max 500 per batch; split if larger). If any address near index GAP-1 shows activity, rerun with a bigger GAP.",
);
