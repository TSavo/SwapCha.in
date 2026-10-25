import { describe, expect, it } from "vitest";
import { convert, outputScript, resetCryptoid, utxoSweep } from "./utxochains.js";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const withKey = async <T>(fn: () => Promise<T>) => {
  resetCryptoid();
  const prev = process.env.CRYPTOID_API_KEY;
  process.env.CRYPTOID_API_KEY = "k";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CRYPTOID_API_KEY;
    else process.env.CRYPTOID_API_KEY = prev;
  }
};
const cidF = (rows: { value: number; script?: string }[]) =>
  (async () =>
    json({
      unspent_outputs: rows.map((r, i) => ({
        tx_hash: (i + 10).toString(16).padStart(2, "0").repeat(32),
        tx_ouput_n: 0,
        confirmations: 50,
        ...r,
      })),
    })) as unknown as typeof fetch;

describe("QRK sweeps (5 decimals, P2PKH only)", () => {
  const a = convert(BTC, "qrk")!;
  it("with P2PKH outputs left after the P2PK filter, still refuses: cryptoid has no raw-transaction endpoint", () =>
    withKey(async () => {
      const own = outputScript(a, "qrk").toString("hex");
      const pk = `21${"02".padEnd(66, "1")}ac`;
      await expect(
        utxoSweep(
          cidF([
            { value: 100000000, script: own },
            { value: 900000000, script: pk },
          ]),
          "qrk",
          a,
          a,
        ),
      ).rejects.toThrow(/no raw-transaction endpoint.*Quark Core/);
    }));
  it("refuses when the UTXO list has no scripts", () =>
    withKey(async () => {
      await expect(utxoSweep(cidF([{ value: 100000000 }]), "qrk", a, a)).rejects.toThrow(/P2PK/);
    }));
  it("refuses when every UTXO is P2PK", () =>
    withKey(async () => {
      await expect(
        utxoSweep(cidF([{ value: 100000000, script: `21${"02".padEnd(66, "1")}ac` }]), "qrk", a, a),
      ).rejects.toThrow(/P2PK/);
    }));
});
