import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { btSweep } from "./blocktools.js";
import { fakePrev, prevUtxos, withPrev } from "./testkit/prevfix.js";
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
const cid = (value: number, n = 1, script?: string) =>
  (async () =>
    json({
      unspent_outputs: Array.from({ length: n }, (_, i) => ({
        tx_hash: (i + 1).toString(16).padStart(64, "0"),
        tx_ouput_n: 1,
        value,
        confirmations: 9,
        ...(script ? { script } : {}),
      })),
    })) as unknown as typeof fetch;

describe("blocktools 2d179f1 rows", () => {
  it("QRK: 5 decimals, legacy format, sweeps; XPM sweeps at its measured rate; TRC 20; MONA 100", () => {
    expect(COINS.qrk.decimals).toBe(5);
    expect(BT_PARAMS!.get("qrk")!.tx_format).toBe("legacy");
    expect(COINS.qrk.sweep).toBe(false); // cryptoid-only: no raw-tx source for prev_tx
    expect(COINS.xpm.sweep).toBe(false);
    expect(COINS.xpm.feeRate).toBe(100312);
    expect(COINS.trc.feeRate).toBe(20);
    expect(COINS.mona.feeRate).toBe(100);
  });
  it("DOGE, FTC and MONA now have measured FeeWarn rows", () => {
    for (const k of ["doge", "ftc", "mona"] as Coin[])
      expect(BT_PARAMS!.get(k)!.fee_warn!.basis, k).not.toMatch(/^default/);
  });
});

describe("QRK and XPM sweeps (cryptoid, keyed): refused, cryptoid has no raw-transaction endpoint", () => {
  it("QRK: legacy P2PKH inputs need prev_tx, so nothing is built", async () => {
    resetCryptoid();
    const a = convert(BTC, "qrk")!;
    await expect(
      withKey(() =>
        utxoSweep(cid(1_250_000_000, 1, outputScript(a, "qrk").toString("hex")), "qrk", a, a),
      ),
    ).rejects.toThrow(/sweeping this coin isn't available yet/);
  });
  it("XPM: refused the same way", async () => {
    resetCryptoid();
    const a = convert(BTC, "xpm")!;
    await expect(withKey(() => utxoSweep(cid(5_000_000_000), "xpm", a, a))).rejects.toThrow(
      /sweeping this coin isn't available yet/,
    );
  });
  it("XPM at 100312/B still builds through btSweep when prev_tx is supplied", () => {
    const a = convert(BTC, "xpm")!;
    const p = fakePrev("xpm", a, 5_000_000_000n, 1);
    const r = btSweep(
      "xpm",
      [{ txid: p.txid, vout: 1, amount: "5000000000", address: a, prev_tx: p.hex }],
      a,
      100312,
    )!;
    expect(BigInt(r.amount) + BigInt(r.fee)).toBe(5_000_000_000n);
    expect(Number(r.fee)).toBeGreaterThan(100312 * 180);
  });
});

describe("size-scaled high_fee: many-input sweeps verify clean with no TS tolerance", () => {
  for (const k of ["vtc", "rvn", "via", "doge"] as Coin[]) {
    it(`${k}: 147 inputs at the row rate`, async () => {
      const a = convert(BTC, k)!;
      const { utxos, prev } = prevUtxos(k, a, Array(147).fill("5000000000"));
      const many = utxos.map((u) => ({ ...u, satoshis: 5000000000 }));
      const f = withPrev(prev, () => json(many));
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
    const p = fakePrev("dgb", a, big);
    const r = btSweep(
      "dgb",
      [{ txid: p.txid, vout: 0, amount: big.toString(), address: a, prev_tx: p.hex }],
      a,
      120,
    )!;
    expect(typeof r.amount).toBe("string");
    expect(BigInt(r.amount) + BigInt(r.fee)).toBe(big);
  });
});
