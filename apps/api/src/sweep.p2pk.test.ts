// P2PK (coinstake) inputs for pos-ntime sweeps (blocktools 4f6445a). Offline: dummy key 1, fabricated prev tx, nothing signed or sent.
import { secp256k1 } from "@noble/curves/secp256k1";
import { createBase58check } from "@scure/base";
import { crypto as bjsCrypto } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { btSweep, btVerify } from "./blocktools.js";
import { decodeFor, p2pkOf, pickSweepUtxos } from "./utxochains.js";

const b58 = createBase58check((m: Uint8Array) => Uint8Array.from(bjsCrypto.sha256(Buffer.from(m))));
const ver = b58.decode("4QmXuz75XYsGXR7rFvbWXHbW7T7Hp2LmYK")[0]!; // public NVC address, version byte only
const pub = Buffer.from(secp256k1.getPublicKey(1n, true));
const h = bjsCrypto.hash160(pub);
const A = b58.encode(Uint8Array.from([ver, ...h]));
const p2pk = `21${pub.toString("hex")}ac`;
const le = (n: number, b = 4) =>
  Buffer.from(Array.from({ length: b }, (_, i) => Number((BigInt(n) >> BigInt(8 * i)) & 255n)));
// pos-ntime tx: version, nTime, 1 dummy input, 1 P2PK output of `value`, locktime
const prevTx = (value: number) =>
  Buffer.concat([
    le(1),
    le(1_700_000_000),
    Buffer.from([1]),
    Buffer.alloc(32, 7),
    le(0),
    Buffer.from([0]),
    le(0xffffffff),
    Buffer.from([1]),
    le(value, 8),
    Buffer.from([35]),
    Buffer.from(p2pk, "hex"),
    le(0),
  ]).toString("hex");
const txid = (hex: string) =>
  Buffer.from(bjsCrypto.hash256(Buffer.from(hex, "hex")))
    .reverse()
    .toString("hex");

describe("pos-ntime P2PK sweep", () => {
  const d = decodeFor(A, "nvc" as never)!;
  it("p2pkOf accepts only the same key", () => {
    expect(p2pkOf(p2pk, d)).toBe(true);
    const other = Buffer.from(secp256k1.getPublicKey(2n, true)).toString("hex");
    expect(p2pkOf(`21${other}ac`, d)).toBe(false);
    // the uncompressed key has a different hash160, so it is not this (compressed-key) address
    expect(p2pkOf(`41${Buffer.from(secp256k1.getPublicKey(1n, false)).toString("hex")}ac`, d)).toBe(
      false,
    );
    expect(p2pkOf("76a914" + "00".repeat(20) + "88ac", d)).toBe(false);
  });
  it("pickSweepUtxos keeps P2PK only with the predicate", () => {
    const u = [{ txid: "aa".repeat(32), vout: 0, value: 10_000_000n, script: p2pk }];
    expect(pickSweepUtxos(u as never, "x", 1)?.utxos ?? []).toHaveLength(0);
    expect(pickSweepUtxos(u as never, "x", 1, (s) => p2pkOf(s, d))?.take).toHaveLength(1);
  });
  const v = 10_000_000;
  const p = prevTx(v);
  const u = { txid: txid(p), vout: 0, address: A };
  const T = 1_800_000_000;
  it("builds and verifies with prev_tx", () => {
    const bt = btSweep("nvc", [{ ...u, amount: v, prev_tx: p }], A, 10, T)!;
    expect(bt.pos_prevouts?.[0]?.script).toBe(p2pk);
    expect(BigInt(bt.amount) + BigInt(bt.fee)).toBe(BigInt(v));
    const r = btVerify(bt.envelope!, "nvc", A, bt.fee) as { ok?: boolean; errors?: unknown[] };
    expect(JSON.stringify(r)).not.toMatch(/"ok":false/);
  });
  it("refuses a wrong amount", () => {
    expect(() => btSweep("nvc", [{ ...u, amount: v + 1, prev_tx: p }], A, 10, T)).toThrow();
  });
  it("refuses a missing prev_tx", () => {
    expect(() => btSweep("nvc", [{ ...u, amount: v }], A, 10, T)).toThrow();
  });
});
