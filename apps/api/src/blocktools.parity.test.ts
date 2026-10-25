import { base58 } from "@scure/base";
import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { blocktools, btConvertFrom, btDetect, btSweep, btValidate } from "./blocktools.js";
import {
  BT_PARAMS,
  COINS,
  type Coin,
  coinsOf,
  convertTs,
  decodeFor,
  outputScript,
  TS_ROWS,
} from "./utxochains.js";

const ROWS = Object.keys(COINS) as Coin[];
/** Rows blocktools verifies; unverified ones (WDC, ANC) and GRS stay on the TS decoder by design. */
const VER = () => ROWS.filter((k) => BT_PARAMS!.get(k)?.verified);
const BTC = [
  "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
  "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
];
const NATIVE = [
  "XssjzLKgsfATYGqTQmiJURQzeKdpL5K1k3", // dash
  "DQTBF89VKPa63aWDZSuex8ZSwNx97EfBEd", // dgb or doge
  "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L", // doge or dgb
  "RHUC17zAVjNqXDtkqwLPRvQ2XgoRZsXeeG", // rvn
  "VbPe6e9gGZaT87YWnJ5kTqtM2X9yDRHdq1", // vtc or via
  "VqvtxyYbwWufXGahdVaE7xH5jMg5jUiKWb",
  "Qd3bXcqgsB7gCrhuRgcFHrJ5iqpLMKTXgF", // qtum or qrk
  "MG2m1jxj22suBNAWocawtdSKGCiFEqTTK1", // mona / ltc-p2sh / qtum-p2sh / mec
  "PKbuwmUS9NWB6kqiWpfuhUfeBKue39D6XZ", // ppc / mona-p2sh / pot
  "AQrh2cuYbknGUoMG5urXZBVx7qxtbgEcxW", // xpm / aur / anc
  "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP", // zec
  "Fr5m2irs9vNWSAFXJK6KPtxqW9YWg384FX", // grs (blocktools 89bf723)
];
const live = blocktools() ? describe : describe.skip;

live("blocktools parity (WASM vs SwapChan TS)", () => {
  it("chainParams matches the TS rows for every shared coin", () => {
    const diffs: string[] = [];
    for (const k of ROWS) {
      const p = BT_PARAMS!.get(k);
      const t = TS_ROWS[k]!;
      if (!p) continue;
      const got = {
        p2pkh: p.p2pkh ?? t.p2pkh,
        p2sh: p.p2sh ?? t.p2sh,
        hrp: p.hrp,
        decimals: p.decimals,
        forkid: p.forkid !== null,
      };
      const want = {
        p2pkh: t.p2pkh,
        p2sh: t.p2sh,
        hrp: t.hrp,
        decimals: t.decimals,
        forkid: t.forkid,
      };
      if (JSON.stringify(got) !== JSON.stringify(want))
        diffs.push(`${k}: bt ${JSON.stringify(got)} ts ${JSON.stringify(want)}`);
      if (t.sweep && !p.sweep_build)
        diffs.push(`${k}: TS sweeps but blocktools cannot build ${p.tx_format}`);
    }
    expect(diffs).toEqual([]);
    expect(ROWS.filter((k) => !BT_PARAMS!.has(k))).toEqual([]);
  });
  it("detectAddress agrees with the TS decoder on every candidate", () => {
    for (const a of [...NATIVE, ...BTC]) {
      const bt = (btDetect(a) ?? []).filter((c) => VER().includes(c as Coin)).sort();
      const ts = VER()
        .filter((k) => decodeFor(a, k))
        .sort();
      expect(bt, a).toEqual(ts);
    }
  });
  it("only WDC and ANC stay on the TS address code", () => {
    expect(ROWS.filter((k) => !BT_PARAMS!.get(k)?.verified).sort()).toEqual(["anc", "wdc"]);
    expect(coinsOf("AQrh2cuYbknGUoMG5urXZBVx7qxtbgEcxW").sort()).toEqual([
      "anc",
      "aur",
      "btg",
      "xpm",
    ]);
  });
  it("coinsOf (now via detectAddress) still never claims BTC-shaped addresses", () => {
    for (const a of BTC) expect(coinsOf(a), a).toEqual([]);
    expect(coinsOf("DQTBF89VKPa63aWDZSuex8ZSwNx97EfBEd").sort()).toEqual(["dgb", "doge"]);
    expect(coinsOf("Fr5m2irs9vNWSAFXJK6KPtxqW9YWg384FX")).toEqual(["grs"]);
  });
  it("addressValidate agrees with decodeFor", () => {
    for (const a of NATIVE)
      for (const k of ROWS.filter((r) => BT_PARAMS!.get(r)?.verified))
        expect(!!btValidate(k, a), `${k} ${a}`).toBe(!!decodeFor(a, k));
  });
  it("convertAddressFrom(btc) == TS convert for every same-key coin", () => {
    for (const a of BTC)
      for (const k of VER()) {
        if (k === "grs") {
          // TS cannot encode the Groestl checksum; compare the payload (version 36 + same hash160) instead
          if (!/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) continue;
          const g = btConvertFrom("btc", a, k);
          const btcRaw = base58.decode(a);
          const raw = base58.decode(g!);
          expect(raw[0], a).toBe(36);
          expect(Buffer.from(raw.slice(1, 21)).equals(Buffer.from(btcRaw.slice(1, 21))), a).toBe(
            true,
          );
          continue;
        }
        expect(btConvertFrom("btc", a, k), `${a} -> ${k}`).toBe(convertTs(a, k));
      }
  });
  it("buildUnsignedSweep spends the same inputs to the same script as the TS builder", () => {
    const sweepers = ROWS.filter((k) => COINS[k].sweep);
    expect(sweepers.sort()).toEqual(
      [
        "bch",
        "blk",
        "bsv",
        "clam",
        "btg",
        "dash",
        "dgb",
        "doge",
        "ftc",
        "grs",
        "ltc",
        "mona",
        "nvc",
        "ppc",
        "qtum",
        "rdd",
        "rvn",
        "via",
        "vtc",
      ].sort(),
    );
    const addr: Partial<Record<Coin, string>> = {
      dash: NATIVE[0],
      dgb: NATIVE[1],
      doge: NATIVE[2],
      rvn: NATIVE[3],
      vtc: NATIVE[4],
      via: NATIVE[5],
      qtum: NATIVE[6],
      mona: NATIVE[7],
      bsv: BTC[0],
      bch: BTC[0],
      grs: "Fr5m2irs9vNWSAFXJK6KPtxqW9YWg384FX",
    };
    for (const [k, a] of Object.entries(addr) as [Coin, string][]) {
      const u = [
        { txid: "aa".repeat(32), vout: 1, amount: 150_000_000, address: a },
        { txid: "bb".repeat(32), vout: 0, amount: 2500, address: a },
      ];
      const r = btSweep(k, u, a, 10)!;
      const tx = Transaction.fromHex(r.unsigned_tx);
      expect(
        tx.ins.map((i) => `${Buffer.from(i.hash).reverse().toString("hex")}:${i.index}`),
        k,
      ).toEqual([`${"aa".repeat(32)}:1`, `${"bb".repeat(32)}:0`]);
      expect(tx.outs.length).toBe(1);
      expect(Buffer.from(tx.outs[0]!.script).toString("hex"), k).toBe(
        outputScript(a, k).toString("hex"),
      );
      const tsFee = 10 * (148 * 2 + 34 + 10);
      expect(Math.abs(Number(r.fee) - tsFee) / tsFee, `${k} fee ${r.fee} vs ${tsFee}`).toBeLessThan(
        0.05,
      );
      expect(BigInt(tx.outs[0]!.value) + BigInt(r.fee)).toBe(150_002_500n);
      expect(r.tx_format).toBe(
        COINS[k].forkid ? "forkid" : k === "grs" ? "legacy-sha256" : "legacy",
      );
    }
  });
  it("blocktools refuses the formats SwapChan refuses", () => {
    for (const k of ["zec", "qrk"] as Coin[]) {
      expect(COINS[k].sweep).toBe(false);
      expect(
        () => btSweep(k, [{ txid: "aa".repeat(32), vout: 0, amount: 1e8, address: "x" }], "x", 10),
        k,
      ).toThrow();
    }
  });
  it("PoS-nTime coins refuse the plain (no-nTime) builder", () => {
    for (const k of ["ppc", "rdd", "nvc", "clam"] as Coin[]) {
      expect(COINS[k].sweep).toBe(true);
      expect(
        () => btSweep(k, [{ txid: "aa".repeat(32), vout: 0, amount: 1e8, address: "x" }], "x", 10),
        k,
      ).toThrow();
    }
  });
});
