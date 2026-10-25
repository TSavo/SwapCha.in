import { createHash } from "node:crypto";
import { base58check, bech32 } from "@scure/base";
import { Transaction } from "bitcoinjs-lib";
import {
  blocktools,
  btAddressToScript,
  btCashToLegacy,
  btConvertFrom,
  btDecode,
  btDetect,
  btParams,
  btSweep,
  btVerify,
  btVersion,
  btXpubAddresses,
} from "./blocktools.js";
import { fetchPrevTxs, type PrevSource } from "./prevtx.js";
import type { NewFound } from "./recover.js";

type F = typeof fetch;
const b58 = base58check((d: Uint8Array) => new Uint8Array(createHash("sha256").update(d).digest()));

/**
 * One row per Bitcoin-family coin. Version bytes, decimals and tx formats follow blocktools' chain table
 * (TSavo/blocktools docs/CHAINS.md, KAT-checked). `src` is the free public explorer the balance comes from
 * (null = no working public explorer: shown as "not checked"). `sweep` = the legacy/FORKID builder below is
 * correct for this coin's tx format; PoS-nTime (PPC/RDD/NVC/CLAM/BLK), Zcash v5, Groestl and unknown formats
 * get a plain note until blocktools builds them. `sameKey` = also checked when a BTC address is scanned.
 * `native` = an address in this coin's own encoding is recognised (false for version-0/5 coins, which are BTC-shaped).
 */
/** Cryptoid-only coins: balances and detection work, but cryptoid has no raw-transaction endpoint, so blocktools
 *  cannot prove legacy input amounts (prev_tx) and no sweep is offered. */
const NO_RAWTX = (wallet: string) =>
  `balance found; sweeping this coin isn't available yet - use the coin's own wallet (${wallet}).`;
export type SrcType = "blockbook" | "insight" | "qtuminfo" | "woc" | "cryptoid";
export type CoinRow = {
  name: string;
  sym: string;
  fork: string | null;
  p2pkh: number[];
  p2sh: number[];
  hrp: string | null;
  cg: string;
  paprika?: string;
  decimals: number;
  feeRate: number;
  forkid: boolean;
  wallet: string;
  src: { type: SrcType; urls: string[] } | null;
  /** raw previous-tx sources when the UTXO source (src) has none, e.g. cryptoid-only coins; each answer is hash-checked */
  prev?: PrevSource[];
  sweep: boolean;
  txNote?: string;
  sameKey: boolean;
  native: boolean;
  checksum?: "sha256d" | "groestl";
};
const bb = (...urls: string[]) => ({ type: "blockbook" as const, urls });
const cid = (t: string) => ({
  type: "cryptoid" as const,
  urls: [`https://chainz.cryptoid.info/${t}`],
});
/** cryptoid's keyed API reports every amount in 1e8 units, whatever the coin's decimals (NVC/PPC use 6). */
export function cidUnits(v: number | string, decimals: number): bigint {
  const n = BigInt(v);
  const k = 10n ** BigInt(8 - decimals);
  if (n % k !== 0n) throw new Error("cryptoid: amount below the coin's precision");
  return n / k;
}
const POS_SIGN =
  "Uses the PoS transaction format (nTime field); SwapChan builds it only through blocktools and checks it with two independent decoders. There is no PSBT for this format: sign the raw tx offline in";
const row = (
  r: Partial<CoinRow> & Pick<CoinRow, "name" | "sym" | "p2pkh" | "p2sh" | "cg" | "wallet">,
): CoinRow => ({
  fork: null,
  hrp: null,
  decimals: 8,
  feeRate: 2,
  forkid: false,
  src: null,
  sweep: false,
  sameKey: true,
  native: true,
  checksum: "sha256d",
  ...r,
});
export const COINS = {
  bch: row({
    name: "Bitcoin Cash",
    sym: "BCH",
    fork: "BTC fork at block 478,558 (Aug 2017)",
    p2pkh: [0],
    p2sh: [5],
    cg: "bitcoin-cash",
    paprika: "bch-bitcoin-cash",
    feeRate: 2,
    forkid: true,
    wallet: "Electron Cash",
    src: bb("https://bchblockexplorer.com", "https://blockbook.bch.zelcore.io"),
    sweep: true,
    native: false,
  }),
  btg: row({
    name: "Bitcoin Gold",
    sym: "BTG",
    fork: "BTC fork at block 491,407 (Oct 2017)",
    p2pkh: [38],
    p2sh: [23],
    hrp: "btg",
    cg: "bitcoin-gold",
    paprika: "btg-bitcoin-gold",
    feeRate: 5,
    forkid: true,
    wallet: "Electrum BTG",
    src: bb("https://btgexplorer.com"),
    sweep: true,
  }),
  bsv: row({
    name: "Bitcoin SV",
    sym: "BSV",
    fork: "BCH fork at block 556,766 (Nov 2018); BTC fork at 478,558",
    p2pkh: [0],
    p2sh: [5],
    cg: "bitcoin-cash-sv",
    paprika: "bsv-bitcoin-sv",
    feeRate: 1,
    forkid: true,
    wallet: "ElectrumSV",
    src: { type: "woc", urls: ["https://api.whatsonchain.com/v1/bsv/main"] },
    sweep: true,
    native: false,
  }),
  ltc: row({
    name: "Litecoin",
    sym: "LTC",
    p2pkh: [48],
    p2sh: [50],
    hrp: "ltc",
    cg: "litecoin",
    paprika: "ltc-litecoin",
    feeRate: 3,
    wallet: "Electrum-LTC",
    src: bb("https://blockbook.ltc.zelcore.io"),
    sweep: true,
  }),
  doge: row({
    name: "Dogecoin",
    sym: "DOGE",
    p2pkh: [30],
    p2sh: [22],
    cg: "dogecoin",
    paprika: "doge-dogecoin",
    // Dogecoin Core policy rate (0.01 DOGE/kB); relays fine and sits under blocktools 761584e's measured DOGE row
    // (warn 1.2e6/B), so it stays.
    feeRate: 1000,
    wallet: "Dogecoin Core / Electrum-DOGE",
    src: bb("https://blockbook.doge.zelcore.io"),
    sweep: true,
  }),
  ftc: row({
    name: "Feathercoin",
    sym: "FTC",
    p2pkh: [14],
    p2sh: [5],
    hrp: "fc",
    cg: "feathercoin",
    paprika: "ftc-feathercoin",
    // blocktools 761584e FTC row: median 2,000 sat/vB, p10 600 over 100 txs (blocks 6407004-6408299). 100 was below
    // anything sampled and risks not relaying; 600 = p10 (paid by real relayed txs), well under blocktools' FTC
    // warn rate 40,000/B and its builder cap max(2000, 4 x 40,000); our own cap is this rate x size x 1.25.
    feeRate: 600,
    wallet: "Feathercoin Core / Electrum-FTC",
    src: bb("https://explorer.feathercoin.com"),
    sweep: true,
  }),
  dash: row({
    name: "Dash",
    sym: "DASH",
    p2pkh: [76],
    p2sh: [16],
    cg: "dash",
    paprika: "dash-dash",
    feeRate: 2,
    wallet: "Dash Core / Dash Electrum",
    src: bb("https://blockbook.dash.zelcore.io"),
    sweep: true,
  }),
  dgb: row({
    name: "DigiByte",
    sym: "DGB",
    p2pkh: [30],
    p2sh: [63],
    hrp: "dgb",
    cg: "digibyte",
    paprika: "dgb-digibyte",
    feeRate: 120,
    wallet: "DigiByte Core",
    src: bb("https://blockbook.dgb.zelcore.io"),
    sweep: true,
  }),
  rvn: row({
    name: "Ravencoin",
    sym: "RVN",
    p2pkh: [60],
    p2sh: [122],
    cg: "ravencoin",
    paprika: "rvn-ravencoin",
    feeRate: 1100,
    wallet: "Ravencoin Core / Electrum-RVN",
    src: bb("https://blockbook.rvn.zelcore.io"),
    sweep: true,
  }),
  vtc: row({
    name: "Vertcoin",
    sym: "VTC",
    p2pkh: [71],
    p2sh: [5],
    hrp: "vtc",
    cg: "vertcoin",
    paprika: "vtc-vertcoin",
    feeRate: 120,
    wallet: "Vertcoin Core / Electrum-VTC",
    src: bb("https://blockbook.vtc.zelcore.io"),
    sweep: true,
  }),
  via: row({
    name: "Viacoin",
    sym: "VIA",
    p2pkh: [71],
    p2sh: [33],
    hrp: "via",
    cg: "viacoin",
    paprika: "via-viacoin",
    feeRate: 120,
    wallet: "Viacoin Core",
    src: bb("https://blockbook.viacoin.org"),
    sweep: true,
  }),
  qtum: row({
    name: "Qtum",
    sym: "QTUM",
    p2pkh: [58],
    p2sh: [50],
    hrp: "qc",
    cg: "qtum",
    paprika: "qtum-qtum",
    feeRate: 450,
    wallet: "Qtum Core / Qtum Electrum",
    src: { type: "qtuminfo", urls: ["https://qtum.info/api"] },
    sweep: true,
  }),
  mona: row({
    name: "Monacoin",
    sym: "MONA",
    p2pkh: [50],
    p2sh: [55],
    hrp: "mona",
    cg: "monacoin",
    paprika: "mona-monacoin",
    // blocktools 761584e MONA verdict: chain median 2.54 sat/vB, p75/p90 100 (Monacoin Core DEFAULT_TRANSACTION_MINFEE
    // 100,000/kB) over 100 txs; no sampled tx paid 220. 100 = the wallet default (was 220).
    feeRate: 100,
    wallet: "Monacoin Core / Electrum-MONA",
    src: { type: "insight", urls: ["https://mona.insight.monaco-ex.org/insight-api-monacoin"] },
    sweep: true,
  }),
  trc: row({
    name: "Terracoin",
    sym: "TRC",
    p2pkh: [0],
    p2sh: [5],
    cg: "terracoin",
    paprika: "trc-terracoin",
    wallet: "Terracoin Core",
    src: { type: "insight", urls: ["https://insight.terracoin.io/api"] },
    native: false,
    // blocktools 2d179f1 docs/CHAINS.md: re-measured median 20.0 sat/B (p10 1.32, p90 20.1) over 100 txs, blocks
    // 3325168-3327910, insight.terracoin.io, txid-checked (was 15 from the earlier 14-tx 14.8 figure); default FeeWarn
    feeRate: 20,
    sweep: true,
    txNote:
      "Terracoin sweeps are built and checked by blocktools; sign them offline in Terracoin Core.",
  }),
  grs: row({
    name: "Groestlcoin",
    sym: "GRS",
    p2pkh: [36],
    p2sh: [5],
    hrp: "grs",
    cg: "groestlcoin",
    paprika: "grs-groestlcoin",
    wallet: "Electrum-GRS",
    src: bb("https://blockbook.grs.zelcore.io"),
    checksum: "groestl",
    // Groestl-512 checksum + single-SHA-256 txid/sighash: built and verified only by blocktools (no TS fallback)
    sweep: true,
    txNote:
      "Groestlcoin uses Groestl hashing; SwapChan builds this sweep only through blocktools. Sign it in Electrum-GRS.",
  }),
  rdd: row({
    name: "Reddcoin",
    sym: "RDD",
    p2pkh: [61],
    p2sh: [5],
    hrp: "rdd",
    cg: "reddcoin",
    paprika: "rdd-reddcoin",
    wallet: "Reddcoin Core",
    src: bb("https://blockbook.reddcoin.com"),
    // measured 2026-10-24: Reddcoin mainnet txs pay 100 sat/B (blockbook.reddcoin.com, blocks 6665400-6666390)
    feeRate: 110,
    sweep: true,
    txNote: `${POS_SIGN} Reddcoin Core.`,
  }),
  ppc: row({
    name: "Peercoin",
    sym: "PPC",
    p2pkh: [55],
    p2sh: [117],
    hrp: "pc",
    cg: "peercoin",
    paprika: "ppc-peercoin",
    decimals: 6,
    wallet: "Peercoin Core",
    src: bb("https://blockbook.peercoin.net"),
    // measured 2026-10-24: Peercoin mainnet txs pay 10 units/B (0.01 PPC/kB), blockbook.peercoin.net
    feeRate: 11,
    sweep: true,
    txNote: `${POS_SIGN} Peercoin Core.`,
  }),
  zec: row({
    name: "Zcash (transparent)",
    sym: "ZEC",
    p2pkh: [0x1c, 0xb8],
    p2sh: [0x1c, 0xbd],
    cg: "zcash",
    paprika: "zec-zcash",
    wallet: "Zcash wallet (Zashi / zcashd)",
    src: bb("https://blockbook.zec.zelcore.io"),
    // ZIP-317: 5000 zat per logical action (~150 bytes per P2PKH input) = ~34 zat/B; blocktools charges max(ZIP-317, size x rate)
    feeRate: 34,
    sweep: true,
    txNote:
      "Zcash transparent (t1, P2PKH) sweeps are built as a v5 transaction by blocktools and checked twice; sign offline in zcashd or another wallet that signs raw v5 transactions. Shielded funds are not covered.",
  }),
  xpm: row({
    name: "Primecoin",
    sym: "XPM",
    p2pkh: [23],
    p2sh: [83],
    cg: "primecoin",
    paprika: "xpm-primecoin",
    wallet: "Primecoin Core",
    src: cid("xpm"),
    // blocktools d4e4ea8: median 100312 sat/B over 30 mainnet txs (exact size), blocks 7064002-7064118 (chainz.cryptoid.info).
    // blocktools 7b70ba4: the builder's rate cap is per coin (max(2000, 4 x FeeWarn rate) = 8,000,000 for XPM), so the
    // measured median is now buildable (c05e88c refused anything over 2000).
    feeRate: 100312,
    sweep: false,
    txNote: NO_RAWTX("Primecoin Core"),
  }),
  aur: row({
    name: "Auroracoin",
    sym: "AUR",
    p2pkh: [23],
    p2sh: [5],
    cg: "auroracoin",
    paprika: "aur-auroracoin",
    wallet: "Auroracoin Core",
    src: cid("aur"),
    // blocktools d4e4ea8: median 102.8 sat/B over 30 mainnet txs (exact size), blocks 5913204-5913347 (chainz.cryptoid.info)
    feeRate: 103,
    sweep: false,
    txNote: NO_RAWTX("Auroracoin Core"),
  }),
  clam: row({
    name: "Clams",
    sym: "CLAM",
    p2pkh: [137],
    p2sh: [13],
    cg: "clams",
    paprika: "clam-clams",
    wallet: "Clam Core",
    src: cid("clam"),
    // Clam Core GetMinFee: MIN_TX_FEE 10000 sat per started kB; 53/B covers that for any tx of 190+ bytes
    feeRate: 53,
    sweep: false,
    txNote: NO_RAWTX("Clam Core"),
  }),
  nvc: row({
    name: "Novacoin",
    sym: "NVC",
    p2pkh: [8],
    p2sh: [20],
    cg: "novacoin",
    paprika: "nvc-novacoin",
    decimals: 6,
    wallet: "Novacoin Core",
    src: cid("nvc"),
    // Novacoin GetMinFee: MIN_TX_FEE = CENT/10 = 1000 units per started kB (6 decimals); 6/B covers it for 190+ bytes
    feeRate: 6,
    sweep: false,
    txNote: NO_RAWTX("Novacoin Core"),
  }),
  blk: row({
    name: "Blackcoin",
    sym: "BLK",
    p2pkh: [25],
    p2sh: [85],
    cg: "blackcoin",
    paprika: "blk-blackcoin",
    wallet: "Blackcoin More",
    src: cid("blk"),
    // BLK is the plain Bitcoin layout (no nTime). Measured mainnet fees: 10000 sat per started kB; 53/B covers it
    feeRate: 53,
    // cryptoid lists the UTXOs; previous txs come from the Blackcoin explorers (hash-checked, witness stripped)
    prev: [
      { type: "iquidus", urls: ["https://mainnet.blackcoin.nl"] },
      { type: "pbcx", urls: ["https://projectblackcoin.org"] },
    ],
    sweep: false,
    txNote: NO_RAWTX("Blackcoin More"),
  }),
  wdc: row({
    name: "Worldcoin (WDC)",
    sym: "WDC",
    p2pkh: [73],
    p2sh: [5],
    cg: "worldcoin",
    paprika: "wdc-worldcoin",
    wallet: "Worldcoin Core",
    src: cid("wdc"),
    txNote:
      "SwapChan does not build Worldcoin transactions yet; import the key into Worldcoin Core to move it.",
  }),
  qrk: row({
    name: "Quark",
    sym: "QRK",
    p2pkh: [58],
    p2sh: [9],
    cg: "quark",
    paprika: "qrk-quark",
    wallet: "Quark Core",
    src: cid("qrk"),
    // Quark src/amount.h: COIN = 100000 (blocktools 761584e; this row said 8 until 2d179f1)
    decimals: 5,
    // blocktools 761584e: Bitcoin-legacy tx format, COIN = 1e5 (5 decimals), confirmed on 10 mainnet txs. Fee: Quark
    // src/main.cpp minRelayTxFee = CFeeRate(100) (100 units/kB) and wallet minTxFee = CFeeRate(10); 1 unit/B is 10x
    // the relay minimum (the builder takes whole units/B). Not measured from chain data.
    feeRate: 1,
    sweep: false,
    txNote: NO_RAWTX("Quark Core"),
  }),
  nmc: row({
    name: "Namecoin",
    sym: "NMC",
    p2pkh: [52],
    p2sh: [13],
    hrp: "nc",
    cg: "namecoin",
    wallet: "Namecoin Core / Electrum-NMC",
  }),
  pot: row({
    name: "Potcoin",
    sym: "POT",
    p2pkh: [55],
    p2sh: [110],
    cg: "potcoin",
    wallet: "Potcoin Core",
  }),
  mec: row({
    name: "Megacoin",
    sym: "MEC",
    p2pkh: [50],
    p2sh: [5],
    hrp: "mec",
    cg: "megacoin",
    wallet: "Megacoin Core",
  }),
  anc: row({
    name: "Anoncoin",
    sym: "ANC",
    p2pkh: [23],
    p2sh: [15],
    cg: "anoncoin",
    wallet: "Anoncoin Core",
  }),
} satisfies Record<string, CoinRow>;
export type Coin = keyof typeof COINS;
const ROWS = Object.entries(COINS) as [Coin, CoinRow][];
/** The TypeScript literals above, before blocktools overrides them (parity tests compare the two). */
export const TS_ROWS: Record<string, CoinRow> = structuredClone(COINS);
/**
 * blocktools' chainParams() is the source of truth for address/tx parameters: version bytes, HRP, decimals,
 * FORKID and whether its sweep builder supports the tx format. SwapChan keeps only what blocktools does not
 * own (explorer adapters, prices, fee defaults, wallet names, notes). GRS is not in blocktools and stays TS.
 */
export const BT_PARAMS = btParams();
export const BLOCKTOOLS_VERSION = btVersion();
if (BT_PARAMS)
  for (const [k, c] of ROWS) {
    const p = BT_PARAMS.get(k);
    if (!p) continue;
    if (p.p2pkh && p.p2sh) {
      c.p2pkh = p.p2pkh;
      c.p2sh = p.p2sh;
    }
    c.hrp = p.hrp;
    c.decimals = p.decimals;
    c.forkid = p.forkid !== null;
    c.sweep = c.sweep && p.sweep_build;
  }

type Decoded = { kind: "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh"; hash: Uint8Array };
const P2SH_ANY = new Set([5, 23, 50, 22]);
/** Decode any base58/bech32 address into its script type + hash, ignoring the coin's version byte (BTC-family 1-byte versions). */
export function decodeAny(addr: string): Decoded | null {
  try {
    const raw = b58.decode(addr.replace(/^bitcoincash:/, ""));
    if (raw.length !== 21) return null;
    return { kind: P2SH_ANY.has(raw[0]!) ? "p2sh" : "p2pkh", hash: raw.slice(1) };
  } catch {}
  return decodeBech(addr);
}
function decodeBech(addr: string, hrp?: string): Decoded | null {
  try {
    const d = bech32.decode(addr.toLowerCase() as `${string}1${string}`);
    if (hrp && d.prefix !== hrp) return null;
    const prog = Uint8Array.from(bech32.fromWords(d.words.slice(1)));
    if (d.words[0] !== 0) return null;
    return { kind: prog.length === 20 ? "p2wpkh" : "p2wsh", hash: prog };
  } catch {
    return null;
  }
}
/** Decode an address for one specific coin (its own version bytes / HRP / checksum), or null. blocktools wasm
 *  addressToScript (fails closed: throws if unavailable). */
export function decodeFor(addr: string, coin: Coin): Decoded | null {
  if (coin === "bch") {
    addr = addr.replace(/^bitcoincash:/, "");
    if (/^[qp][a-z0-9]{41}$/.test(addr)) return null; // CashAddr goes through cashToLegacy first
  }
  const s = btAddressToScript(coin, addr);
  if (!s) return null;
  const b = Buffer.from(s, "hex");
  if (b.length === 25 && s.startsWith("76a914") && s.endsWith("88ac"))
    return { kind: "p2pkh", hash: b.subarray(3, 23) };
  if (b.length === 23 && s.startsWith("a914") && s.endsWith("87"))
    return { kind: "p2sh", hash: b.subarray(2, 22) };
  if (b.length === 22 && s.startsWith("0014")) return { kind: "p2wpkh", hash: b.subarray(2) };
  if (b.length === 34 && s.startsWith("0020")) return { kind: "p2wsh", hash: b.subarray(2) };
  return null;
}
/** Same key/script, encoded for another coin (null when that coin has no such address type or needs a Groestl checksum). */
export function convert(addr: string, coin: Coin): string | null {
  if (BT_PARAMS?.get(coin)?.verified && BT_PARAMS.has("btc")) {
    const btc = btConvertFrom("btc", addr, coin);
    if (btc) return btc;
  }
  return convertTs(addr, coin);
}
/** TypeScript conversion (GRS/ZEC, non-BTC sources, and the fallback when the WASM is unavailable). */
export function convertTs(addr: string, coin: Coin): string | null {
  const d = decodeAny(addr);
  if (!d) return null;
  const c: CoinRow = COINS[coin];
  if (d.kind === "p2pkh" || d.kind === "p2sh") {
    if (c.checksum === "groestl") return null;
    return b58.encode(Uint8Array.from([...(d.kind === "p2pkh" ? c.p2pkh : c.p2sh), ...d.hash]));
  }
  return c.hrp ? bech32.encode(c.hrp, [0, ...bech32.toWords(d.hash)]) : null;
}
function script(d: Decoded): Buffer {
  const h = Buffer.from(d.hash);
  if (d.kind === "p2pkh")
    return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), h, Buffer.from([0x88, 0xac])]);
  if (d.kind === "p2sh") return Buffer.concat([Buffer.from([0xa9, 0x14]), h, Buffer.from([0x87])]);
  return Buffer.concat([Buffer.from([0x00, h.length]), h]);
}
/** scriptPubKey for an address of `coin` (blocktools wasm via decodeFor; throws on an invalid address or a missing WASM). */
export function outputScript(addr: string, coin: Coin): Buffer {
  const d = decodeFor(addr, coin);
  if (!d) throw new Error("unrecognised address");
  return script(d);
}
/** BCH CashAddr (bitcoincash:q.../p..., prefix optional) -> legacy base58, checksum verified; null otherwise.
 *  blocktools wasm (fails closed: throws if unavailable). */
export const cashToLegacy = (addr: string): string | null => btCashToLegacy(addr);
const GRS_RE = /^(F[1-9A-HJ-NP-Za-km-z]{33}|grs1[02-9ac-hj-np-z]{38,58})$/;
/**
 * Every coin a native (non-BTC) address could belong to. Version bytes collide (DGB/DOGE 30, VIA/VTC 71,
 * MONA p2pkh = LTC/QTUM p2sh 50, PPC p2pkh = MONA p2sh 55, XPM/AUR/BTG-p2sh 23, QTUM/QRK 58), so all
 * candidates are returned and each is scanned as its own source. BTC-shaped (version 0/5) addresses return [].
 */
/** A Groestlcoin extended public key (Groestl-512 base58 checksum, so it never validates as a BTC xpub). */
export const isGrsXpub = (a: string) =>
  /^[xyzt]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(a) &&
  !!btXpubAddresses(a, "grs", ["p2pkh"], [0], [0]);
export function coinsOf(addr: string): Coin[] {
  if (isGrsXpub(addr)) return ["grs"];
  if (/^(bitcoincash:)?[qp][a-z0-9]{41}$/.test(addr)) return ["bch"];
  const bt = btDetect(addr);
  if (bt && BT_PARAMS?.get("grs")?.verified ? bt.includes("grs") : GRS_RE.test(addr))
    return ["grs"];
  const out: Coin[] = [];
  for (const [k, c] of ROWS)
    if (
      c.native &&
      k !== "grs" &&
      (bt && BT_PARAMS?.get(k)?.verified ? bt.includes(k) : decodeFor(addr, k)) &&
      !(c.p2pkh.length === 1 && [0, 5].includes(b58raw0(addr)))
    )
      out.push(k);
  return out;
}
const b58raw0 = (a: string) => {
  try {
    return b58.decode(a)[0]!;
  } catch {
    return -1;
  }
};
/** The first candidate coin (kept for callers that want one name). BTC addresses return null. */
export function coinOf(addr: string): Coin | null {
  return coinsOf(addr)[0] ?? null;
}

const UA = { "user-agent": "Mozilla/5.0 swapchan" };
async function getJson<T>(f: F, urls: string[], path: string, label: string): Promise<T> {
  let last: unknown;
  for (const base of urls) {
    try {
      const r = await f(`${base}${path}`, { headers: UA, signal: AbortSignal.timeout(7000) });
      if (r.ok) return (await r.json()) as T;
      last = r.status;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${label} explorer unavailable (${String(last).slice(0, 40)})`);
}

// chainz.cryptoid.info: keyless = 1 call / 10 s; with the key we use multiaddr and cache. One shared queue for all coins.
const CID_GAP_KEYED = 1100,
  CID_GAP_FREE = 10_000;
let cidNext = 0;
const cidCache = new Map<string, { at: number; v: bigint }>();
/** test hook: clear the shared cryptoid queue and cache */
export const resetCryptoid = () => {
  cidNext = 0;
  cidCache.clear();
};
async function cidSlot(keyed: boolean, deadline: number) {
  const now = Date.now();
  const at = Math.max(now, cidNext);
  if (at > deadline) throw new Error("cryptoid rate limit (queued)");
  cidNext = at + (keyed ? CID_GAP_KEYED : CID_GAP_FREE);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}
async function cryptoidBalance(
  f: F,
  coin: Coin,
  a: string,
  env: NodeJS.ProcessEnv,
): Promise<bigint> {
  const c: CoinRow = COINS[coin];
  const ck = `${coin}:${a}`;
  const hit = cidCache.get(ck);
  if (hit && Date.now() - hit.at < 600_000) return hit.v;
  const key = env.CRYPTOID_API_KEY;
  await cidSlot(!!key, Date.now() + 8000);
  const base = c.src!.urls[0]!;
  let v: bigint;
  if (key) {
    const r = await f(
      `${base}/api.dws?q=multiaddr&active=${encodeURIComponent(a)}&key=${encodeURIComponent(key)}`,
      { headers: UA, signal: AbortSignal.timeout(7000) },
    );
    if (!r.ok) throw new Error(`cryptoid ${r.status}`);
    const j = (await r.json()) as {
      addresses?: { address: string; final_balance: number | string }[];
    };
    if (!Array.isArray(j.addresses)) throw new Error("cryptoid: bad answer");
    // cryptoid answers {"addresses":[]} for an address it has never seen on chain: that is a measured zero, not an error
    const e = j.addresses.find((x) => x.address === a);
    v = e ? cidUnits(e.final_balance, c.decimals) : 0n;
  } else {
    const r = await f(`${base}/api.dws?q=getbalance&a=${encodeURIComponent(a)}`, {
      headers: UA,
      signal: AbortSignal.timeout(7000),
    });
    const t = (await r.text()).trim();
    if (!r.ok || !/^\d+(\.\d+)?$/.test(t)) throw new Error("cryptoid: bad answer");
    const [w, d = ""] = t.split(".");
    v =
      BigInt(w!) * 10n ** BigInt(c.decimals) +
      BigInt((d + "0".repeat(c.decimals)).slice(0, c.decimals) || "0");
  }
  cidCache.set(ck, { at: Date.now(), v });
  if (cidCache.size > 5000) cidCache.delete(cidCache.keys().next().value!);
  return v;
}

/** Balance in base units from the coin's source adapter. */
export async function coinBalance(
  f: F,
  coin: Coin,
  a: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<bigint> {
  const c: CoinRow = COINS[coin];
  if (!c.src) throw new Error("no public explorer");
  const u = c.src.urls;
  switch (c.src.type) {
    case "blockbook": {
      const r = await getJson<{ balance: string; unconfirmedBalance?: string }>(
        f,
        u,
        `/api/v2/address/${a}?details=basic`,
        c.sym,
      );
      return BigInt(r.balance) + BigInt(r.unconfirmedBalance ?? "0");
    }
    case "insight": {
      const r = await getJson<{ balanceSat: number; unconfirmedBalanceSat?: number }>(
        f,
        u,
        `/addr/${a}/?noTxList=1`,
        c.sym,
      );
      return BigInt(r.balanceSat) + BigInt(r.unconfirmedBalanceSat ?? 0);
    }
    case "qtuminfo": {
      const r = await getJson<{ balance: string; unconfirmed?: string }>(
        f,
        u,
        `/address/${a}`,
        c.sym,
      );
      return BigInt(r.balance) + BigInt(r.unconfirmed ?? "0");
    }
    case "woc": {
      const r = await getJson<{ confirmed: number; unconfirmed: number }>(
        f,
        u,
        `/address/${a}/balance`,
        c.sym,
      );
      return BigInt(r.confirmed) + BigInt(r.unconfirmed);
    }
    case "cryptoid":
      return cryptoidBalance(f, coin, a, env);
  }
}
/** script: the output's scriptPubKey hex when the source reports it (cryptoid does); used to skip P2PK outputs */
type Utxo = { txid: string; vout: number; value: string; script?: string };
/** Spendable UTXOs from the coin's source adapter (immature Qtum stakes excluded). */
export async function coinUtxos(
  f: F,
  coin: Coin,
  a: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Utxo[]> {
  const c: CoinRow = COINS[coin];
  const u = c.src?.urls ?? [];
  switch (c.src?.type) {
    case "blockbook":
      return (
        (
          await getJson<
            {
              txid: string;
              vout: number;
              value: string;
              coinbase?: boolean;
              confirmations?: number;
            }[]
          >(f, u, `/api/v2/utxo/${a}`, c.sym)
        )
          // immature coinbase (under 100 confirmations) cannot be spent yet; a sweep including it would be rejected
          .filter((x) => !x.coinbase || (x.confirmations ?? 0) >= 100)
          .map((x) => ({ txid: x.txid, vout: x.vout, value: String(x.value) }))
      );
    case "insight":
      return (
        await getJson<{ txid: string; vout: number; satoshis: number }[]>(
          f,
          u,
          `/addr/${a}/utxo`,
          c.sym,
        )
      ).map((x) => ({ txid: x.txid, vout: x.vout, value: String(x.satoshis) }));
    case "qtuminfo":
      return (
        await getJson<
          {
            transactionId: string;
            outputIndex: number;
            value: string;
            isStake?: boolean;
            confirmations?: number;
          }[]
        >(f, u, `/address/${a}/utxo`, c.sym)
      )
        .filter((x) => !x.isStake || (x.confirmations ?? 0) >= 501)
        .map((x) => ({ txid: x.transactionId, vout: x.outputIndex, value: String(x.value) }));
    case "woc":
      return (
        await getJson<{ tx_hash: string; tx_pos: number; value: number }[]>(
          f,
          u,
          `/address/${a}/unspent`,
          c.sym,
        )
      ).map((x) => ({ txid: x.tx_hash, vout: x.tx_pos, value: String(x.value) }));
    case "cryptoid": {
      // needs the cryptoid key (keyless cryptoid has no unspent endpoint); shares the cryptoid rate queue
      const key = env.CRYPTOID_API_KEY;
      if (!key) throw new Error(`${c.sym}: UTXO list needs the cryptoid key`);
      await cidSlot(true, Date.now() + 8000);
      const r = await f(
        `${u[0]!}/api.dws?q=unspent&active=${encodeURIComponent(a)}&key=${encodeURIComponent(key)}`,
        { headers: UA, signal: AbortSignal.timeout(7000) },
      );
      if (!r.ok) throw new Error(`cryptoid ${r.status}`);
      const j = (await r.json()) as {
        unspent_outputs?: {
          tx_hash: string;
          tx_ouput_n: number;
          value: number | string;
          addr?: string;
          confirmations?: number;
          script?: string;
        }[];
      };
      if (!Array.isArray(j.unspent_outputs)) throw new Error("cryptoid: bad answer");
      return j.unspent_outputs
        .filter((x) => !x.addr || x.addr === a)
        .map((x) => ({
          txid: x.tx_hash,
          vout: x.tx_ouput_n,
          value: String(cidUnits(x.value, c.decimals)),
          ...(typeof x.script === "string" ? { script: x.script.toLowerCase() } : {}),
        }));
    }
    default:
      throw new Error(`${c.sym}: no UTXO source`);
  }
}

const PAPRIKA: Record<string, string> = {
  ripple: "xrp-xrp",
  stellar: "xlm-stellar",
  algorand: "algo-algorand",
  cosmos: "atom-cosmos",
  polkadot: "dot-polkadot",
  "the-open-network": "ton-toncoin",
  cardano: "ada-cardano",
  "ethereum-classic": "etc-ethereum-classic",
  ...Object.fromEntries(ROWS.filter(([, c]) => c.paprika).map(([, c]) => [c.cg, c.paprika!])),
};
export async function coinPrices(f: F, ids: string[]): Promise<Record<string, number>> {
  ids = [...new Set(ids)];
  const r = await f(
    `https://coins.llama.fi/prices/current/${ids.map((i) => `coingecko:${i}`).join(",")}`,
    { signal: AbortSignal.timeout(5000) },
  )
    .then((x) => x.json() as Promise<{ coins: Record<string, { price: number }> }>)
    .catch(() => ({ coins: {} }));
  const out: Record<string, number> = Object.fromEntries(
    Object.entries(r.coins ?? {}).map(([k, v]) => [k.replace("coingecko:", ""), v.price]),
  );
  const miss = ids.filter((i) => out[i] == null);
  if (miss.length) {
    const g = await f(
      `https://api.coingecko.com/api/v3/simple/price?ids=${miss.join(",")}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(4000) },
    )
      .then((x) => x.json() as Promise<Record<string, { usd?: number }>>)
      .catch(() => ({}) as Record<string, { usd?: number }>);
    for (const i of miss) if (g[i]?.usd) out[i] = g[i]!.usd!;
  }
  // last resort (CoinGecko rate-limits the server): CoinPaprika for coins DefiLlama does not price
  await Promise.all(
    ids
      .filter((i) => out[i] == null && PAPRIKA[i])
      .map(async (i) => {
        const t = await f(`https://api.coinpaprika.com/v1/tickers/${PAPRIKA[i]}`, {
          signal: AbortSignal.timeout(4000),
        })
          .then((x) => x.json() as Promise<{ quotes?: { USD?: { price?: number } } }>)
          .catch(() => null);
        if (t?.quotes?.USD?.price) out[i] = t.quotes.USD.price;
      }),
  );
  return out;
}

export const SIGN_GUIDE = (coin: Coin) => {
  const c: CoinRow = COINS[coin];
  return `${c.forkid ? `${c.sym} signatures use SIGHASH_FORKID, so a ${c.sym} spend cannot be replayed on BTC; still move or check your BTC first, and only sign in a ${c.sym}-aware wallet (${c.wallet}). ` : ""}Sign offline in ${c.wallet}; never type a seed or key into a website. SwapChan never sees keys.`;
};

export type UtxoSource = {
  name: string;
  coin: Coin;
  address: string;
  /** own deadline when the source is slower by design (paced lookups); callers default to their usual one */
  ms?: number;
  run: () => Promise<NewFound[]>;
};
/**
 * One source per coin to check, each meant to run in parallel under its own deadline (see intel.ts `timed`).
 * Native address: every candidate coin for its version bytes. BTC address: every `sameKey` coin with a source.
 * Coins with no public explorer come back in `notChecked` instead.
 */
export function utxoSources(
  f: F,
  address: string,
  env: NodeJS.ProcessEnv = process.env,
): { sources: UtxoSource[]; notChecked: string[] } {
  const natives = coinsOf(address);
  const isNative = natives.length > 0;
  const targets: Coin[] = isNative ? natives : ROWS.filter(([, c]) => c.sameKey).map(([k]) => k);
  const notChecked: string[] = [];
  let px: Promise<Record<string, number>> | null = null;
  const prices = () =>
    (px ??= coinPrices(
      f,
      targets.filter((t) => COINS[t].src).map((t) => COINS[t].cg),
    ));
  const sources: UtxoSource[] = [];
  if (natives[0] === "grs" && isGrsXpub(address)) {
    sources.push(grsXpubSource(f, address, env, prices));
    return { sources, notChecked };
  }
  for (const coin of targets) {
    const c: CoinRow = COINS[coin];
    const a = isNative ? address : convert(address, coin);
    if (!a) continue;
    if (!c.src) {
      notChecked.push(`${c.name}: no working public explorer (not checked)`);
      continue;
    }
    sources.push({
      name: `${c.name} balance`,
      coin,
      address: a,
      run: async () => {
        const [base, p] = await Promise.all([
          coinBalance(f, coin, a, env),
          prices().catch(() => ({}) as Record<string, number>),
        ]);
        if (base <= 0n) return [];
        const amt = Number(base) / 10 ** c.decimals,
          usd = p[c.cg];
        const sameKey = !isNative
          ? c.fork
            ? ` — ${c.fork}; same key as your BTC address`
            : " — same key as your BTC address"
          : "";
        const ambiguous =
          natives.length > 1
            ? ` (this address format is shared by ${natives.map((n) => COINS[n].sym).join("/")}; balance shown is on ${c.sym})`
            : "";
        return [
          {
            kind: "claimable",
            protocol: `${c.name}${c.fork && !isNative ? " (fork coins)" : ""}`,
            chainId: 0,
            what: `${amt} ${c.sym} on ${a}${sameKey}${ambiguous} (exact balance; USD estimate)`,
            valueUsd: usd ? Math.round(amt * usd * 100) / 100 : null,
            action: c.sweep
              ? `Build an unsigned sweep with /onchain/utxo-sweep?coin=${coin}&from=${a}&to=<your ${c.sym} address>, then sign it offline. ${SIGN_GUIDE(coin)}`
              : `${c.txNote ?? `SwapChan does not build ${c.sym} transactions yet.`} Never type a seed or key into a website.`,
            confidence: "high",
            ...(c.sweep ? { sweep: { kind: "utxo", coin, from: a, sym: c.sym } } : {}),
            evidence: [
              {
                chainId: 0,
                address: a,
                call: `${c.src!.type} ${coin} address balance`,
                args: [],
                raw: base.toString(),
              },
            ],
          } as NewFound,
        ];
      },
    });
  }
  return { sources, notChecked };
}

/** Receive 0-9 and change 0-4 for P2PKH, P2WPKH and P2TR, derived by blocktools; balances from Groestlcoin Blockbook. */
/**
 * GRS xpub: Blockbook's own xpub lookup (one call per script type, descriptors pkh()/wpkh()/tr(); Blockbook walks the
 * gap limit itself), run one after another with a 429 retry so the explorer never sees a burst (45 paced per-address
 * lookups hit 429 and took ~17 s on 2026-10-25). Every funded address Blockbook returns is re-derived by blocktools
 * addressesFromXpub at the same branch/index; a mismatch is refused, not shown.
 */
export const GRS_XPUB_PACE = { retries: 2, backoffMs: 1500, ms: 12_000 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const GRS_XPUB_DESC = [
  ["p2pkh", "pkh"],
  ["p2wpkh", "wpkh"],
  ["p2tr", "tr"],
] as const;
type BbXpub = { txs?: number; tokens?: { name: string; path?: string; balance?: string }[] };
function grsXpubSource(
  f: F,
  xpub: string,
  _env: NodeJS.ProcessEnv,
  prices: () => Promise<Record<string, number>>,
): UtxoSource {
  const c = COINS.grs;
  const get = async (path: string): Promise<BbXpub> => {
    for (let t = 0; ; t++) {
      try {
        return await getJson<BbXpub>(f, c.src!.urls, path, c.sym);
      } catch (e) {
        if (t >= GRS_XPUB_PACE.retries || !/429/.test(String((e as Error).message))) throw e;
        await sleep(GRS_XPUB_PACE.backoffMs * (t + 1));
      }
    }
  };
  return {
    ms: GRS_XPUB_PACE.ms,
    name: `${c.name} xpub balance`,
    coin: "grs",
    address: xpub,
    run: async () => {
      const found: { kind: string; path: string; address: string; base: bigint }[] = [];
      let used = 0;
      for (const [kind, d] of GRS_XPUB_DESC) {
        const r = await get(
          `/api/v2/xpub/${encodeURIComponent(`${d}(${xpub})`)}?details=tokenBalances&tokens=nonzero`,
        );
        used += r.txs ?? 0;
        for (const t of r.tokens ?? []) {
          const base = BigInt(t.balance ?? "0");
          if (base <= 0n) continue;
          const m = /(\d+)\/(\d+)$/.exec(t.path ?? "");
          const mine =
            m && btXpubAddresses(xpub, "grs", [kind], [Number(m[1])], [Number(m[2])])?.[0];
          if (!mine || mine.address !== t.name)
            throw new Error(
              `explorer address ${t.name.slice(0, 12)} does not match blocktools derivation`,
            );
          found.push({ kind, path: mine.path, address: t.name, base });
        }
      }
      const p = await prices().catch(() => ({}) as Record<string, number>);
      return found.map(({ kind, path, address, base }) => {
        const amt = Number(base) / 10 ** c.decimals,
          usd = p[c.cg];
        const tr = kind === "p2tr";
        return {
          kind: "claimable",
          protocol: c.name,
          chainId: 0,
          what: `${amt} ${c.sym} on ${address} (xpub path ${path}, ${kind}; Blockbook xpub scan of P2PKH/P2WPKH/P2TR, ${used} txs, address re-derived by blocktools) (exact balance; USD estimate)`,
          valueUsd: usd ? Math.round(amt * usd * 100) / 100 : null,
          action: tr
            ? "Taproot (grs1p) funds are recognised but SwapChan does not build taproot spends; restore the wallet in Electrum-GRS. Never type a seed or key into a website."
            : `Build an unsigned sweep with /onchain/utxo-sweep?coin=grs&from=${address}&to=<your GRS address>, then sign it offline. ${SIGN_GUIDE("grs")}`,
          confidence: "high",
          ...(tr ? {} : { sweep: { kind: "utxo", coin: "grs", from: address, sym: c.sym } }),
          evidence: [
            {
              chainId: 0,
              address,
              call: `blockbook xpub ${kind}; blocktools addressesFromXpub ${path}`,
              args: [],
              raw: base.toString(),
            },
          ],
        } as NewFound;
      });
    },
  };
}

/** All sources for one address, each under its own deadline; a slow or failing coin becomes its own "not checked" line. */
export async function utxoScan(
  f: F,
  address: string,
  env: NodeJS.ProcessEnv = process.env,
  ms = Number(env.FIND_UTXO_SOURCE_MS ?? 9000),
): Promise<{ items: NewFound[]; notChecked: string[] }> {
  const { sources, notChecked } = utxoSources(f, address, env);
  const items: NewFound[] = [];
  await Promise.all(
    sources.map(async (s) => {
      let to: ReturnType<typeof setTimeout> | undefined;
      try {
        const r = await Promise.race([
          s.run(),
          new Promise<never>((_, rej) => {
            const m = s.ms ?? ms;
            to = setTimeout(() => rej(new Error(`timed out after ${m / 1000}s`)), m);
          }),
        ]);
        items.push(...r);
      } catch (e) {
        notChecked.push(
          `${COINS[s.coin].name}: not checked (${String((e as Error)?.message ?? e).slice(0, 60)})`,
        );
      } finally {
        clearTimeout(to);
      }
    }),
  );
  return { items, notChecked };
}

export const BT_ONLY_SWEEP = new Set<string>([
  "dash",
  "dgb",
  "rvn",
  "vtc",
  "via",
  "qtum",
  "mona",
  "bsv",
  "grs",
  "ppc",
  "nvc",
  "clam",
  "rdd",
  "blk",
  "trc",
  "aur",
  "zec",
  "xpm",
  "qrk",
]);
/** Proof-of-stake nTime chains: built with buildUnsignedSweepAt, no PSBT. */
export const POS_NTIME = new Set<string>(["ppc", "nvc", "clam", "rdd"]);

/**
 * Independent (non-blocktools) parse of a pos-ntime tx: PPC/NVC/CLAM v1 carry u32 nTime after the version; RDD v2 after
 * the locktime; CLAM v2+ appends a varstr after the locktime. Returns null on any malformation or trailing bytes.
 */
export function parsePosTx(coin: string, hex: string) {
  const b = Buffer.from(hex, "hex");
  if (b.toString("hex") !== hex.toLowerCase()) return null;
  let p = 0;
  const take = (n: number) => {
    if (p + n > b.length) throw new Error("short");
    const s = b.subarray(p, p + n);
    p += n;
    return s;
  };
  const vi = () => {
    const x = take(1)[0]!;
    if (x < 0xfd) return x;
    if (x === 0xfd) return take(2).readUInt16LE();
    if (x === 0xfe) return take(4).readUInt32LE();
    throw new Error("varint");
  };
  try {
    const version = take(4).readInt32LE();
    const afterVersion = coin === "ppc" || coin === "nvc" || coin === "clam";
    const afterLock = coin === "rdd" && version > 1;
    if (!afterVersion && coin !== "rdd") return null;
    let time = afterVersion ? take(4).readUInt32LE() : 0;
    const nIn = vi();
    if (!nIn) return null;
    const ins: { txid: string; vout: number; script: Buffer }[] = [];
    for (let i = 0; i < nIn; i++) {
      const txid = Buffer.from(take(32)).reverse().toString("hex");
      const vout = take(4).readUInt32LE();
      const script = Buffer.from(take(vi()));
      take(4);
      ins.push({ txid, vout, script });
    }
    const nOut = vi();
    const outs: { value: bigint; script: Buffer }[] = [];
    for (let i = 0; i < nOut; i++) {
      const value = take(8).readBigUInt64LE();
      outs.push({ value, script: Buffer.from(take(vi())) });
    }
    take(4);
    if (afterLock) time = take(4).readUInt32LE();
    if (coin === "clam" && version > 1) take(vi());
    if (p !== b.length) return null;
    return { version, time, ins, outs };
  } catch {
    return null;
  }
}

/**
 * Independent (non-blocktools) parse of a transparent-only Zcash v5 tx (ZIP-225): header 0x80000005, version group
 * 0x26A7270A, branch id, locktime, expiry, transparent ins/outs, then empty Sapling and Orchard bundles. Returns null on
 * anything else (v4/v6, shielded parts, trailing bytes).
 */
export function parseZecV5(hex: string) {
  const b = Buffer.from(hex, "hex");
  if (b.toString("hex") !== hex.toLowerCase()) return null;
  let p = 0;
  const take = (n: number) => {
    if (p + n > b.length) throw new Error("short");
    const s = b.subarray(p, p + n);
    p += n;
    return s;
  };
  const vi = () => {
    const x = take(1)[0]!;
    if (x < 0xfd) return x;
    if (x === 0xfd) return take(2).readUInt16LE();
    if (x === 0xfe) return take(4).readUInt32LE();
    throw new Error("varint");
  };
  try {
    if (take(4).readUInt32LE() !== 0x80000005) return null;
    if (take(4).readUInt32LE() !== 0x26a7270a) return null;
    const branchId = take(4).readUInt32LE().toString(16).padStart(8, "0");
    const locktime = take(4).readUInt32LE();
    const expiry = take(4).readUInt32LE();
    const ins: { txid: string; vout: number; script: Buffer; sequence: number }[] = [];
    for (let i = 0, n = vi(); i < n; i++) {
      const txid = Buffer.from(take(32)).reverse().toString("hex");
      const vout = take(4).readUInt32LE();
      const script = Buffer.from(take(vi()));
      ins.push({ txid, vout, script, sequence: take(4).readUInt32LE() });
    }
    const outs: { value: bigint; script: Buffer }[] = [];
    for (let i = 0, n = vi(); i < n; i++) {
      const value = take(8).readBigUInt64LE();
      outs.push({ value, script: Buffer.from(take(vi())) });
    }
    // nSpendsSapling, nOutputsSapling, nActionsOrchard: all must be 0 for a transparent-only tx
    if (vi() !== 0 || vi() !== 0 || vi() !== 0) return null;
    if (p !== b.length || !ins.length) return null;
    return { branchId, locktime, expiry, ins, outs };
  } catch {
    return null;
  }
}
/** Current Zcash consensus branch id (hex) from the coin's Blockbook backend (zcashd getblockchaininfo.consensus). */
async function zecBranch(f: F): Promise<{ chaintip: string; nextblock: string }> {
  const r = await getJson<{ backend?: { consensus?: { chaintip?: string; nextblock?: string } } }>(
    f,
    COINS.zec.src!.urls,
    "/api/v2",
    "ZEC",
  );
  const c = r.backend?.consensus;
  if (!c?.chaintip || !c.nextblock)
    throw new Error("ZEC explorer did not report the consensus branch id");
  return { chaintip: c.chaintip, nextblock: c.nextblock };
}

/** Unsigned legacy-format sweep of every UTXO on `from` to `to` (one output, fee = feeRate x size estimate). Only coins with `sweep`. */
export async function utxoSweep(f: F, coin: Coin, from: string, to: string, feeRate?: number) {
  // BCH: accept CashAddr for either side; the builder and both decoders work on the legacy form (same hash)
  if (coin === "bch") {
    from = cashToLegacy(from) ?? from;
    to = cashToLegacy(to) ?? to;
  }
  const c: CoinRow = COINS[coin];
  if (!c.sweep || (c.checksum === "groestl" && !BT_PARAMS?.get(coin)?.sweep_build))
    throw new Error(c.txNote ?? `SwapChan does not build ${c.sym} transactions yet`);
  if (coin === "grs" && /^grs1p/i.test(from))
    throw new Error(
      "Groestlcoin taproot (grs1p) inputs are recognised but not spendable through SwapChan; use Electrum-GRS",
    );
  const toD = decodeFor(to, coin);
  if (!toD) throw new Error(`to must be a ${c.sym} address`);
  const fromD = decodeFor(from, coin);
  if (!fromD) throw new Error(`from must be a ${c.sym} address`);
  const all = await coinUtxos(f, coin, from);
  if (!all.length) throw new Error("no UTXOs on this address");
  // only outputs paying this address's own script: a P2PK output (same key, pubkey in the prevout) would be
  // described with the wrong scriptPubKey, and blocktools cannot verify P2PK inputs. QRK fails closed without scripts.
  const own = script(fromD).toString("hex");
  if (coin === "qrk" && all.some((u) => u.script === undefined))
    throw new Error(
      "the Quark UTXO list has no output scripts, so P2PK outputs cannot be told apart; not built (use Quark Core)",
    );
  const utxos = all.filter((u) => u.script === undefined || u.script === own);
  const notOwn = all.length - utxos.length;
  if (!utxos.length)
    throw new Error(
      `all ${all.length} UTXOs on this address are P2PK or another script type SwapChan cannot verify; use ${c.wallet}`,
    );
  const rate = feeRate ?? c.feeRate;
  // largest first, skipping UTXOs where the input's own fee would exceed 5% of its value (dust farms on VIA/DGB
  // hold thousands); blocktools rejects a sweep whose fee is over 5% of the output (high_fee_pct)
  const economic = [...utxos]
    .sort((a, b) =>
      BigInt(b.value) > BigInt(a.value) ? 1 : BigInt(b.value) < BigInt(a.value) ? -1 : 0,
    )
    .filter((u) => BigInt(u.value) >= BigInt(Math.ceil(rate * 148 * 20)));
  if (!economic.length)
    throw new Error(
      "every UTXO on this address is too small to spend economically (its fee would be over 5% of its value)",
    );
  let take = economic.slice(0, 200);
  let total = take.reduce((s, u) => s + BigInt(u.value), 0n);
  const pos = POS_NTIME.has(coin);
  const zec = coin === "zec";
  // Legacy P2PKH inputs (and every pos-ntime input) must carry their previous tx: the legacy sighash does not commit
  // to the amount, so blocktools refuses to build without it (BCH/BSV/BTG included). ZEC v5 commits to amounts.
  let prevNote = "";
  const prevTx = new Map<string, string>();
  // no wasm: refuse before any network fetch (fail closed, no TS fallback)
  if (!blocktools()) {
    if (c.checksum === "groestl") throw new Error(c.txNote!);
    throw new Error(
      `blocktools is unavailable, so SwapChan will not offer an unverified ${c.sym} sweep; try again later`,
    );
  }
  if (!zec && (pos || fromD.kind === "p2pkh")) {
    const ps = c.prev ?? (c.src && c.src.type !== "cryptoid" ? [c.src] : []);
    if (!ps.length)
      throw new Error(
        `${c.sym}: the UTXO source has no raw-transaction endpoint, so the input amounts cannot be proven; not built (use ${c.wallet})`,
      );
    const { got, failed } = await fetchPrevTxs(
      f,
      coin,
      ps,
      take.map((u) => u.txid),
      c.checksum === "groestl",
    );
    const kept = take.filter((u) => got.has(u.txid.toLowerCase()));
    const keptTotal = kept.reduce((s, u) => s + BigInt(u.value), 0n);
    // build only if at least 90% of the selected value can be proven; otherwise fail with a plain reason
    if (!kept.length || keptTotal * 10n < total * 9n)
      throw new Error(
        `could not fetch the previous transactions for ${take.length - kept.length} of ${take.length} inputs (${[...new Set(failed.values())].slice(0, 2).join("; ") || "explorer unavailable"}); they prove the input amounts, so the ${c.sym} sweep was not built; try again later`,
      );
    if (kept.length < take.length)
      prevNote = `${take.length - kept.length} inputs left out (previous transaction unavailable); run again later for them`;
    for (const [t, h] of got) prevTx.set(t, h);
    take = kept;
    total = keptTotal;
  }
  if (zec && (fromD.kind !== "p2pkh" || toD.kind !== "p2pkh"))
    throw new Error("Zcash sweeps support transparent P2PKH (t1) addresses only");
  // ZEC: check blocktools' embedded branch id against the live chain before building (independent of blocktools)
  const branch = zec ? await zecBranch(f) : null;
  const txTime = pos ? Math.floor(Date.now() / 1000) : undefined;
  const bt = btSweep(
    coin,
    take.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      amount: u.value,
      address: from,
      prev_tx: prevTx.get(u.txid.toLowerCase()),
    })),
    to,
    rate,
    txTime,
  );
  if (!bt && c.checksum === "groestl") throw new Error(c.txNote!);
  // every sweep is a blocktools-built, decode+verify-checked transaction; no unverified TS fallback (fail closed)
  if (!bt)
    throw new Error(
      `blocktools is unavailable, so SwapChan will not offer an unverified ${c.sym} sweep; try again later`,
    );
  if (BigInt(bt.amount) <= 546n) throw new Error("balance does not cover the fee");
  // decode + verify the built PSBT before offering it: inputs are ours, every output pays `to`, fee as built
  // pos-ntime has no PSBT: blocktools checks its JSON envelope (unsigned tx + pos_prevouts carrying the amounts)
  const checkInput = pos || zec ? bt.envelope : bt.psbt;
  if (!checkInput) throw new Error(`built ${c.sym} sweep has nothing to verify; not offered`);
  const v = btVerify(checkInput, coin, to, String(bt.fee));
  const d = btDecode(checkInput, coin);
  const sum = d?.find((l) => l.role === "summary");
  const outs = d?.filter((l) => l.role === "output") ?? [];
  // Fee checks. Our own cap always applies: row fee rate x legacy size estimate x 1.25 (ZEC: also ZIP-317 x 1.25).
  // blocktools 7b70ba4/761584e own the fee verdict: high_fee is size-scaled (FeeWarn fee per started 1000 vB) and
  // high_fee_rate uses the coin's measured row (DOGE/FTC/MONA now measured), so every fee warning is a hard failure;
  // only "unsigned" is expected. (Until c05e88c SwapChan tolerated high_fee on every coin and high_fee_rate on
  // default-row coins because the absolute limit did not scale with input count and DOGE had no row.)
  const rateCap = Math.ceil(rate * (148 * take.length + 34 + 10) * 1.25);
  const feeCap = BigInt(
    zec ? Math.max(rateCap, Math.ceil(5000 * Math.max(2, take.length + 1) * 1.25)) : rateCap,
  );
  const okWarn = new Set(["unsigned"]);
  const verifiedOk =
    BigInt(bt.fee) <= feeCap &&
    !!v &&
    !v.warnings.includes("high_fee_pct") &&
    (v.ok ||
      (v.failures.every((x) => x === "has_warnings") && v.warnings.every((x) => okWarn.has(x))));
  // independent second decode (bitcoinjs, not blocktools): same inputs in order, one output paying `to` the built amount
  let tsOk = false;
  try {
    if (zec) {
      const t = parseZecV5(bt.unsigned_tx);
      const prev = bt.zec_prevouts ?? [];
      tsOk =
        !!t &&
        !!branch &&
        t.branchId === bt.branch_id &&
        t.branchId === branch.chaintip &&
        t.branchId === branch.nextblock &&
        t.ins.length === take.length &&
        t.ins.every(
          (i, n) =>
            i.txid === take[n]!.txid &&
            i.vout === take[n]!.vout &&
            i.script.length === 0 &&
            i.sequence === 0xffffffff,
        ) &&
        prev.length === take.length &&
        prev.every(
          (x, n) =>
            String(x.amount) === String(take[n]!.value) &&
            x.script === script(fromD).toString("hex"),
        ) &&
        t.outs.length === 1 &&
        t.outs[0]!.script.equals(script(toD)) &&
        String(t.outs[0]!.value) === String(bt.amount) &&
        total - BigInt(bt.amount) === BigInt(bt.fee);
    } else if (pos) {
      const t = parsePosTx(coin, bt.unsigned_tx);
      const prev = bt.pos_prevouts ?? [];
      tsOk =
        !!t &&
        t.time === txTime &&
        bt.time === txTime &&
        t.ins.length === take.length &&
        t.ins.every(
          (i, n) => i.txid === take[n]!.txid && i.vout === take[n]!.vout && i.script.length === 0,
        ) &&
        prev.length === take.length &&
        prev.every(
          (x, n) =>
            String(x.amount) === String(take[n]!.value) &&
            x.script === script(fromD).toString("hex"),
        ) &&
        t.outs.length === 1 &&
        t.outs[0]!.script.equals(script(toD)) &&
        String(t.outs[0]!.value) === String(bt.amount) &&
        total - BigInt(bt.amount) === BigInt(bt.fee);
    } else {
      const t = Transaction.fromHex(bt.unsigned_tx);
      tsOk =
        t.ins.length === take.length &&
        t.ins.every(
          (i, n) =>
            Buffer.from(i.hash).reverse().toString("hex") === take[n]!.txid &&
            i.index === take[n]!.vout,
        ) &&
        t.outs.length === 1 &&
        Buffer.from(t.outs[0]!.script).equals(script(toD)) &&
        String(t.outs[0]!.value) === String(bt.amount) &&
        total - BigInt(bt.amount) === BigInt(bt.fee);
    }
  } catch {
    tsOk = false;
  }
  if (
    !tsOk ||
    !verifiedOk ||
    !sum ||
    sum.inputs !== take.length ||
    String(sum.fee) !== String(bt.fee) ||
    outs.length !== 1 ||
    outs[0]!.address !== to ||
    String(outs[0]!.amount) !== String(bt.amount)
  )
    throw new Error(
      `built ${c.sym} sweep failed verification (${[...(v?.failures ?? []), ...(v?.warnings ?? [])].join(", ") || "decode mismatch"}); not offered`,
    );
  return {
    coin,
    from,
    to,
    unsignedTx: bt.unsigned_tx,
    psbt: bt.psbt,
    txFormat: bt.tx_format,
    ...(pos ? { txTime: txTime!, posPrevouts: bt.pos_prevouts } : {}),
    ...(zec
      ? {
          zcash: {
            branchId: bt.branch_id,
            expiryHeight: bt.expiry_height,
            prevouts: bt.zec_prevouts,
          },
        }
      : {}),
    builtBy: `blocktools ${BLOCKTOOLS_VERSION}`,
    verified: { by: "blocktools decodeTx+verifyTx", txid: sum.txid, warnings: v!.warnings },
    fee: String(bt.fee),
    amount: String(bt.amount),
    inputs: take.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      scriptPubKey: script(fromD).toString("hex"),
    })),
    signing: SIGN_GUIDE(coin),
    note:
      [
        utxos.length > take.length
          ? `largest ${take.length} of ${utxos.length} UTXOs${economic.length < utxos.length ? ` (${utxos.length - economic.length} too small to spend economically skipped)` : ""}; run again after this confirms`
          : "",
        notOwn ? `${notOwn} P2PK/other-script UTXOs skipped (move them in ${c.wallet})` : "",
        prevNote,
      ]
        .filter(Boolean)
        .join("; ") || undefined,
  };
}
