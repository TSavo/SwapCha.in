import { base58check, bech32 } from "@scure/base";
import { createHash } from "node:crypto";
import { Transaction } from "bitcoinjs-lib";
import type { NewFound } from "./recover.js";

type F = typeof fetch;
const b58 = base58check((d: Uint8Array) => new Uint8Array(createHash("sha256").update(d).digest()));
/** Bitcoin-family chains read through free public Blockbook instances (tested from the live server). */
export const COINS = {
  bch: { name: "Bitcoin Cash", sym: "BCH", fork: "BTC fork at block 478,558 (Aug 2017)", p2pkh: 0, p2sh: 5, hrp: null, cg: "bitcoin-cash", feeRate: 2, forkid: true, wallet: "Electron Cash", bb: ["https://bchblockexplorer.com", "https://blockbook.bch.zelcore.io"] },
  btg: { name: "Bitcoin Gold", sym: "BTG", fork: "BTC fork at block 491,407 (Oct 2017)", p2pkh: 38, p2sh: 23, hrp: "btg", cg: "bitcoin-gold", feeRate: 5, forkid: true, wallet: "Electrum BTG", bb: ["https://btgexplorer.com"] },
  ltc: { name: "Litecoin", sym: "LTC", fork: null, p2pkh: 48, p2sh: 50, hrp: "ltc", cg: "litecoin", feeRate: 3, forkid: false, wallet: "Electrum-LTC", bb: ["https://blockbook.ltc.zelcore.io"] },
  doge: { name: "Dogecoin", sym: "DOGE", fork: null, p2pkh: 30, p2sh: 22, hrp: null, cg: "dogecoin", feeRate: 1000, forkid: false, wallet: "Dogecoin Core / Electrum-DOGE", bb: ["https://blockbook.doge.zelcore.io"] },
  ftc: { name: "Feathercoin", sym: "FTC", fork: null, p2pkh: 14, p2sh: 5, hrp: "fc", cg: "feathercoin", feeRate: 100, forkid: false, wallet: "Feathercoin Core / Electrum-FTC", bb: ["https://explorer.feathercoin.com"] },
} as const;
export type Coin = keyof typeof COINS;

type Decoded = { kind: "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh"; hash: Uint8Array };
/** Decode any base58/bech32 address into its script type + hash, ignoring the coin's version byte. */
export function decodeAny(addr: string): Decoded | null {
  try {
    const raw = b58.decode(addr.replace(/^bitcoincash:/, ""));
    if (raw.length !== 21) return null;
    const v = raw[0]!;
    const p2sh = [5, 23, 50, 22].includes(v);
    return { kind: p2sh ? "p2sh" : "p2pkh", hash: raw.slice(1) };
  } catch {}
  try {
    const d = bech32.decode(addr.toLowerCase() as `${string}1${string}`);
    const prog = Uint8Array.from(bech32.fromWords(d.words.slice(1)));
    if (d.words[0] !== 0) return null;
    return { kind: prog.length === 20 ? "p2wpkh" : "p2wsh", hash: prog };
  } catch {}
  return null;
}
/** Same key/script, encoded for another coin (null when that coin has no such address type). */
export function convert(addr: string, coin: Coin): string | null {
  const d = decodeAny(addr);
  if (!d) return null;
  const c = COINS[coin];
  if (d.kind === "p2pkh" || d.kind === "p2sh") return b58.encode(Uint8Array.from([d.kind === "p2pkh" ? c.p2pkh : c.p2sh, ...d.hash]));
  return c.hrp ? bech32.encode(c.hrp, [0, ...bech32.toWords(d.hash)]) : null;
}
export function outputScript(addr: string): Buffer {
  const d = decodeAny(addr);
  if (!d) throw new Error("unrecognised address");
  const h = Buffer.from(d.hash);
  if (d.kind === "p2pkh") return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), h, Buffer.from([0x88, 0xac])]);
  if (d.kind === "p2sh") return Buffer.concat([Buffer.from([0xa9, 0x14]), h, Buffer.from([0x87])]);
  return Buffer.concat([Buffer.from([0x00, h.length]), h]);
}
/** Which coin a native address belongs to, by prefix. BTC addresses return null (scanned as fork + same-key). */
export function coinOf(addr: string): Coin | null {
  if (/^(bitcoincash:)?[qp][a-z0-9]{41}$/.test(addr)) return "bch";
  if (/^ltc1/i.test(addr) || /^[LM][1-9A-HJ-NP-Za-km-z]{32,33}$/.test(addr)) return "ltc";
  if (/^D[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return "doge";
  if (/^G[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr) || /^btg1/i.test(addr)) return "btg";
  if (/^6[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr) || /^fc1/i.test(addr)) return "ftc";
  return null;
}

async function bb<T>(f: F, coin: Coin, path: string): Promise<T> {
  let last: unknown;
  for (const base of COINS[coin].bb) {
    try {
      const r = await f(`${base}/api/v2/${path}`, { headers: { "user-agent": "Mozilla/5.0 swapchan" }, signal: AbortSignal.timeout(7000) });
      if (r.ok) return (await r.json()) as T;
      last = r.status;
    } catch (e) { last = e; }
  }
  throw new Error(`${coin} blockbook unavailable (${String(last)})`);
}
export async function coinPrices(f: F, ids: string[]): Promise<Record<string, number>> {
  const r = await f(`https://coins.llama.fi/prices/current/${ids.map((i) => `coingecko:${i}`).join(",")}`, { signal: AbortSignal.timeout(5000) })
    .then((x) => x.json() as Promise<{ coins: Record<string, { price: number }> }>).catch(() => ({ coins: {} }));
  const out: Record<string, number> = Object.fromEntries(Object.entries(r.coins).map(([k, v]) => [k.replace("coingecko:", ""), v.price]));
  const miss = ids.filter((i) => out[i] == null);
  if (miss.length) {
    const g = await f(`https://api.coingecko.com/api/v3/simple/price?ids=${miss.join(",")}&vs_currencies=usd`, { signal: AbortSignal.timeout(4000) })
      .then((x) => x.json() as Promise<Record<string, { usd?: number }>>).catch(() => ({}) as Record<string, { usd?: number }>);
    for (const i of miss) if (g[i]?.usd) out[i] = g[i]!.usd!;
  }
  return out;
}

export const SIGN_GUIDE = (coin: Coin) => {
  const c = COINS[coin];
  return `${c.forkid ? `${c.sym} signatures use SIGHASH_FORKID, so a ${c.sym} spend cannot be replayed on BTC; still move or check your BTC first, and only sign in a ${c.sym}-aware wallet (${c.wallet}). ` : ""}Sign offline in ${c.wallet}; never type a seed or key into a website. SwapChan never sees keys.`;
};

/** Scan one address on the given coins. For a BTC address: BCH + BTG (fork coins) and LTC/DOGE/FTC (same key). */
export async function utxoScan(f: F, address: string): Promise<{ items: NewFound[]; notChecked: string[] }> {
  const native = coinOf(address);
  const targets: Coin[] = native ? [native] : ["bch", "btg", "ltc", "doge", "ftc"];
  const px = await coinPrices(f, targets.map((c) => COINS[c].cg));
  const items: NewFound[] = [], notChecked: string[] = [];
  await Promise.all(targets.map(async (coin) => {
    const a = native ? address : convert(address, coin);
    if (!a) return;
    const c = COINS[coin];
    try {
      const r = await bb<{ balance: string; unconfirmedBalance?: string; txs?: number }>(f, coin, `address/${a}?details=basic`);
      const sats = BigInt(r.balance) + BigInt(r.unconfirmedBalance ?? "0");
      if (sats <= 0n) return;
      const amt = Number(sats) / 1e8, p = px[c.cg];
      items.push({
        kind: "claimable", protocol: `${c.name}${c.fork && !native ? " (fork coins)" : ""}`, chainId: 0,
        what: `${amt} ${c.sym} on ${a}${c.fork && !native ? ` — ${c.fork}; same key as your BTC address` : !native ? " — same key as your BTC address" : ""} (exact balance; USD estimate)`,
        valueUsd: p ? Math.round(amt * p * 100) / 100 : null,
        action: `Build an unsigned sweep with /onchain/utxo-sweep?coin=${coin}&from=${a}&to=<your ${c.sym} address>, then sign it offline. ${SIGN_GUIDE(coin)}`,
        confidence: "high",
        evidence: [{ chainId: 0, address: a, call: `blockbook ${coin} address balance`, args: [], raw: sats.toString() }],
      } as NewFound);
    } catch { notChecked.push(`${c.name}: explorer unavailable (not checked)`); }
  }));
  return { items, notChecked };
}

/** Unsigned legacy-format sweep of every UTXO on `from` to `to` (one output, fee = feeRate x size estimate). */
export async function utxoSweep(f: F, coin: Coin, from: string, to: string, feeRate?: number) {
  const c = COINS[coin];
  if (coinOf(to) !== coin && !(coin === "bch" && decodeAny(to)?.kind === "p2pkh")) throw new Error(`to must be a ${c.sym} address`);
  const utxos = await bb<{ txid: string; vout: number; value: string }[]>(f, coin, `utxo/${from}`);
  if (!utxos.length) throw new Error("no UTXOs on this address");
  const take = utxos.slice(0, 200);
  const total = take.reduce((s, u) => s + BigInt(u.value), 0n);
  const fee = BigInt(Math.ceil((feeRate ?? c.feeRate) * (148 * take.length + 34 + 10)));
  if (total <= fee + 546n) throw new Error("balance does not cover the fee");
  const tx = new Transaction();
  tx.version = coin === "btg" || coin === "bch" ? 2 : 1;
  for (const u of take) tx.addInput(Buffer.from(u.txid, "hex").reverse(), u.vout, 0xffffffff);
  tx.addOutput(outputScript(to), total - fee);
  return {
    coin, from, to, unsignedTx: tx.toHex(), fee: fee.toString(), amount: (total - fee).toString(),
    inputs: take.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, scriptPubKey: outputScript(from).toString("hex") })),
    signing: SIGN_GUIDE(coin),
    note: utxos.length > take.length ? `first ${take.length} of ${utxos.length} UTXOs; run again after this confirms` : undefined,
  };
}
