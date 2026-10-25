import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { btSweep } from "./blocktools.js";
import {
  BT_PARAMS,
  COINS,
  type Coin,
  convert,
  outputScript,
  resetCryptoid,
  utxoSweep,
} from "./utxochains.js";

// blocktools 7b70ba4 (per-coin fee-rate cap, size-scaled high_fee, amount_str/fee_str), 761584e (measured
// DOGE/FTC/MONA FeeWarn rows, QRK legacy + 5 decimals + sweep), 2d179f1 (TRC re-measured at 20 sat/B)
const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const json = (v: unknown) => new Response(JSON.stringify(v));
const withKey = async <T>(fn: () => Promise<T>) => {
  const prev = process.env.CRYPTOID_API_KEY;
  process.env.CRYPTOID_API_KEY = "k";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CRYPTOID_API_KEY;
    else process.env.CRYPTOID_API_KEY = prev;
  }
};
const cid = (value: number, n = 1) =>
  (async () =>
    json({
      unspent_outputs: Array.from({ length: n }, (_, i) => ({
        tx_hash: (i + 1).toString(16).padStart(64, "0"),
        tx_ouput_n: 1,
        value,
        confirmations: 9,
      })),
    })) as unknown as typeof fetch;

describe("blocktools 2d179f1 rows", () => {
  it("QRK: 5 decimals, legacy format, sweeps; XPM sweeps at its measured rate; TRC 20; MONA 100", () => {
    expect(COINS.qrk.decimals).toBe(5);
    expect(BT_PARAMS!.get("qrk")!.tx_format).toBe("legacy");
    expect(COINS.qrk.sweep).toBe(true);
    expect(COINS.xpm.sweep).toBe(true);
    expect(COINS.xpm.feeRate).toBe(100312);
    expect(COINS.trc.feeRate).toBe(20);
    expect(COINS.mona.feeRate).toBe(100);
  });
  it("DOGE, FTC and MONA now have measured FeeWarn rows", () => {
    for (const k of ["doge", "ftc", "mona"] as Coin[])
      expect(BT_PARAMS!.get(k)!.fee_warn!.basis, k).not.toMatch(/^default/);
  });
});

describe("QRK and XPM sweeps via blocktools (cryptoid, keyed)", () => {
  it("QRK: cryptoid 1e8 units scaled to 5 decimals, legacy tx at 1 unit/B, verified clean", async () => {
    resetCryptoid();
    const a = convert(BTC, "qrk")!;
    // 12.5 QRK = 1,250,000,000 in cryptoid's 1e8 units = 1,250,000 QRK units
    const s = await withKey(() => utxoSweep(cid(1_250_000_000), "qrk", a, a));
    expect(BigInt(s.amount) + BigInt(s.fee)).toBe(1_250_000n);
    const tx = Transaction.fromHex(s.unsignedTx);
    expect(tx.ins.length).toBe(1);
    expect(Buffer.from(tx.outs[0]!.script).equals(outputScript(a, "qrk"))).toBe(true);
    expect(Number(s.fee)).toBeLessThan(400);
    expect((s as { builtBy?: string }).builtBy).toMatch(/^blocktools /);
    expect((s as { verified?: { warnings: string[] } }).verified?.warnings).toEqual(["unsigned"]);
  });
  it("XPM: builds at 100312/B (over the old 2000 cap), verified clean", async () => {
    resetCryptoid();
    const a = convert(BTC, "xpm")!;
    const s = await withKey(() => utxoSweep(cid(5_000_000_000), "xpm", a, a));
    expect(BigInt(s.amount) + BigInt(s.fee)).toBe(5_000_000_000n);
    expect(Number(s.fee)).toBeGreaterThan(100312 * 180);
    expect((s as { verified?: { warnings: string[] } }).verified?.warnings).toEqual(["unsigned"]);
  });
});

describe("size-scaled high_fee: many-input sweeps verify clean with no TS tolerance", () => {
  for (const k of ["vtc", "rvn", "via", "doge"] as Coin[]) {
    it(`${k}: 147 inputs at the row rate`, async () => {
      const many = Array.from({ length: 147 }, (_, n) => ({
        txid: (n + 1).toString(16).padStart(64, "0"),
        vout: 0,
        value: "5000000000",
        satoshis: 5000000000,
      }));
      const f = (async () => json(many)) as unknown as typeof fetch;
      const a = convert(BTC, k)!;
      const s = await utxoSweep(f, k, a, a);
      expect(s.inputs.length).toBe(147);
      expect((s as { verified?: { warnings: string[] } }).verified?.warnings).toEqual(["unsigned"]);
    });
  }
});

describe("string amounts above 2^53", () => {
  it("a UTXO of 2^53+1 units builds, and amount + fee is exact", () => {
    const a = convert(BTC, "dgb")!;
    const big = 2n ** 53n + 1n;
    const r = btSweep(
      "dgb",
      [{ txid: "aa".repeat(32), vout: 0, amount: big.toString(), address: a }],
      a,
      120,
    )!;
    expect(typeof r.amount).toBe("string");
    expect(BigInt(r.amount) + BigInt(r.fee)).toBe(big);
  });
});
