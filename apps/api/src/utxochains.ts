import { createHash } from "node:crypto";
import { base58check, bech32 } from "@scure/base";
import { Transaction } from "bitcoinjs-lib";
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
const POS =
  "Uses the PoS transaction format (nTime field); SwapChan does not build this transaction yet. Import the key into";
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
    feeRate: 100,
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
    feeRate: 220,
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
    txNote:
      "SwapChan does not build Terracoin transactions yet; import the key into Terracoin Core to move it.",
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
    txNote:
      "Groestlcoin uses Groestl hashing for txids and signatures; SwapChan does not build this transaction yet. Import the key into Electrum-GRS to move it.",
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
    txNote: `${POS} Reddcoin Core to move it.`,
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
    txNote: `${POS} Peercoin Core to move it.`,
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
    txNote:
      "Zcash needs a v5 transaction with its consensus branch id; SwapChan does not build it yet. Import the key into Zashi or zcashd to move it.",
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
    txNote:
      "SwapChan does not build Primecoin transactions yet; import the key into Primecoin Core to move it.",
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
    txNote:
      "SwapChan does not build Auroracoin transactions yet; import the key into Auroracoin Core to move it.",
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
    txNote: `${POS} Clam Core to move it.`,
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
    txNote: `${POS} Novacoin Core to move it.`,
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
    txNote: `${POS} Blackcoin More to move it.`,
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
    txNote:
      "Quark's transaction format is not verified; SwapChan does not build it. Import the key into Quark Core to move it.",
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
const eq = (a: Uint8Array, v: number[]) => v.every((x, i) => a[i] === x);
/** Decode an address for one specific coin (its own version bytes / HRP), or null. */
export function decodeFor(addr: string, coin: Coin): Decoded | null {
  const c: CoinRow = COINS[coin];
  if (coin === "bch") addr = addr.replace(/^bitcoincash:/, "");
  try {
    const raw = b58.decode(addr);
    const n = c.p2pkh.length;
    if (raw.length !== 20 + n) return null;
    if (eq(raw, c.p2pkh)) return { kind: "p2pkh", hash: raw.slice(n) };
    if (eq(raw, c.p2sh)) return { kind: "p2sh", hash: raw.slice(n) };
    return null;
  } catch {}
  return c.hrp ? decodeBech(addr, c.hrp) : null;
}
/** Same key/script, encoded for another coin (null when that coin has no such address type or needs a Groestl checksum). */
export function convert(addr: string, coin: Coin): string | null {
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
export function outputScript(addr: string, coin?: Coin): Buffer {
  const d = coin ? decodeFor(addr, coin) : decodeAny(addr);
  if (!d) throw new Error("unrecognised address");
  return script(d);
}
const GRS_RE = /^(F[1-9A-HJ-NP-Za-km-z]{33}|grs1[02-9ac-hj-np-z]{38,58})$/;
/**
 * Every coin a native (non-BTC) address could belong to. Version bytes collide (DGB/DOGE 30, VIA/VTC 71,
 * MONA p2pkh = LTC/QTUM p2sh 50, PPC p2pkh = MONA p2sh 55, XPM/AUR/BTG-p2sh 23, QTUM/QRK 58), so all
 * candidates are returned and each is scanned as its own source. BTC-shaped (version 0/5) addresses return [].
 */
export function coinsOf(addr: string): Coin[] {
  if (/^(bitcoincash:)?[qp][a-z0-9]{41}$/.test(addr)) return ["bch"];
  if (GRS_RE.test(addr)) return ["grs"];
  const out: Coin[] = [];
  for (const [k, c] of ROWS)
    if (
      c.native &&
      c.checksum !== "groestl" &&
      decodeFor(addr, k) &&
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
    const e = j.addresses?.find((x) => x.address === a);
    if (!e) throw new Error("cryptoid: no answer for address");
    v = BigInt(e.final_balance);
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
type Utxo = { txid: string; vout: number; value: string };
/** Spendable UTXOs from the coin's source adapter (immature Qtum stakes excluded). */
export async function coinUtxos(f: F, coin: Coin, a: string): Promise<Utxo[]> {
  const c: CoinRow = COINS[coin];
  const u = c.src?.urls ?? [];
  switch (c.src?.type) {
    case "blockbook":
      return (
        await getJson<{ txid: string; vout: number; value: string }[]>(
          f,
          u,
          `/api/v2/utxo/${a}`,
          c.sym,
        )
      ).map((x) => ({ txid: x.txid, vout: x.vout, value: String(x.value) }));
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
    default:
      throw new Error(`${c.sym}: no UTXO source`);
  }
}

const PAPRIKA: Record<string, string> = {
  ripple: "xrp-xrp",
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
            to = setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms);
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

/** Unsigned legacy-format sweep of every UTXO on `from` to `to` (one output, fee = feeRate x size estimate). Only coins with `sweep`. */
export async function utxoSweep(f: F, coin: Coin, from: string, to: string, feeRate?: number) {
  const c: CoinRow = COINS[coin];
  if (!c.sweep) throw new Error(c.txNote ?? `SwapChan does not build ${c.sym} transactions yet`);
  const toD = decodeFor(to, coin);
  if (!toD) throw new Error(`to must be a ${c.sym} address`);
  const fromD = decodeFor(from, coin);
  if (!fromD) throw new Error(`from must be a ${c.sym} address`);
  const utxos = await coinUtxos(f, coin, from);
  if (!utxos.length) throw new Error("no UTXOs on this address");
  const take = utxos.slice(0, 200);
  const total = take.reduce((s, u) => s + BigInt(u.value), 0n);
  const fee = BigInt(Math.ceil((feeRate ?? c.feeRate) * (148 * take.length + 34 + 10)));
  if (total <= fee + 546n) throw new Error("balance does not cover the fee");
  const tx = new Transaction();
  tx.version = coin === "btg" || coin === "bch" ? 2 : 1;
  for (const u of take) tx.addInput(Buffer.from(u.txid, "hex").reverse(), u.vout, 0xffffffff);
  tx.addOutput(script(toD), total - fee);
  return {
    coin,
    from,
    to,
    unsignedTx: tx.toHex(),
    fee: fee.toString(),
    amount: (total - fee).toString(),
    inputs: take.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      scriptPubKey: script(fromD).toString("hex"),
    })),
    signing: SIGN_GUIDE(coin),
    note:
      utxos.length > take.length
        ? `first ${take.length} of ${utxos.length} UTXOs; run again after this confirms`
        : undefined,
  };
}
