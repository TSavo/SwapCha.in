import { base58, base64 } from "@scure/base";
import * as bitcoin from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { crossCheckPsbt, crossCheckSvm } from "./btcheck.js";
import { parseSvmBase64 } from "./svm.js";

const ME = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const VAULT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const psbt = (from = ME) => {
  const p = new bitcoin.Psbt();
  p.addInput({
    hash: "11".repeat(32),
    index: 0,
    witnessUtxo: { script: bitcoin.address.toOutputScript(from), value: 100000n },
  });
  p.addOutput({ address: VAULT, value: 50000n });
  p.addOutput({ address: ME, value: 49000n });
  return p.toBase64();
};
const outs = [
  { address: VAULT, value: 50000n },
  { address: ME, value: 49000n },
];

describe("blocktools cross-check of non-EVM payloads (fail closed)", () => {
  it("PSBT: agrees with the guard's parse", () => {
    expect(crossCheckPsbt(psbt(), outs, ME)).toEqual([]);
  });
  it("PSBT: refuses foreign inputs, differing outputs, garbage", () => {
    expect(crossCheckPsbt(psbt(VAULT), outs, ME).join()).toMatch(/not the taker/);
    expect(crossCheckPsbt(psbt(), [outs[0]!, { address: ME, value: 1n }], ME).join()).toMatch(
      /output 1 differs/,
    );
    expect(crossCheckPsbt(psbt(), outs.slice(0, 1), ME).join()).toMatch(/count/);
    expect(crossCheckPsbt("cHNidP8=", outs, ME)).not.toEqual([]);
  });
  it("Solana: fee payer and program list must match", () => {
    const payer = new Uint8Array(32).fill(7);
    const prog = new Uint8Array(32).fill(9);
    const msg = [1, 0, 1, 2, ...payer, ...prog, ...new Uint8Array(32), 1, 1, 1, 0, 0];
    const tx = base64.encode(new Uint8Array([1, ...new Uint8Array(64), ...msg]));
    const t = parseSvmBase64(tx);
    const progs = t.ixs.map((i) => i.programId);
    expect(crossCheckSvm(tx, t.feePayer, progs)).toEqual([]);
    expect(crossCheckSvm(tx, base58.encode(prog), progs).join()).toMatch(/fee payer/);
    expect(crossCheckSvm(tx, t.feePayer, [...progs, "x"]).join()).toMatch(/programs/);
    expect(crossCheckSvm("AA==", t.feePayer, progs)).not.toEqual([]);
  });
});
