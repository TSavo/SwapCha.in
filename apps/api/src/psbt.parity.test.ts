import { readFileSync } from "node:fs";
import { Psbt } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { btBuildPsbt } from "./blocktools.js";

// Frozen outputs of the old TS builder (btc.ts buildBtcPsbt, bitcoinjs-lib 7, deleted after this switch):
// psbt-memo-corpus.json = blocktools tools/psbt-parity/gen.mts (150 + 1 regression), psbt-memo-60.json = 60 random
// vectors (1-12 UTXOs, rates 1-120, memos 0-80 B, some short of funds). The only allowed diff: memo > 75 B needs
// OP_PUSHDATA1, so blocktools charges 1 vB more (change exactly feeRate sats lower).
type V = {
  name: string;
  from: string;
  to: string;
  amount: string;
  memo: string;
  feeRate: number;
  utxos: { txid: string; vout: number; value: number }[];
  psbt?: string;
  error?: string;
};
const load = (f: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8")) as V[];
const run = (v: V) =>
  btBuildPsbt(
    "btc",
    v.utxos.map((u) => ({ txid: u.txid, vout: u.vout, amount: u.value, address: v.from })),
    v.to,
    BigInt(v.amount),
    v.from,
    v.feeRate,
    Buffer.from(v.memo, "utf8").toString("hex"),
  );
function compare(vs: V[]) {
  const diffs: string[] = [];
  let memoShift = 0;
  for (const v of vs) {
    if (v.error) {
      expect(() => run(v), v.name).toThrow();
      continue;
    }
    const want = Psbt.fromBase64(v.psbt!);
    const got = Psbt.fromBase64(run(v).psbt);
    const ins = (p: Psbt) =>
      p.txInputs.map(
        (i) =>
          `${Buffer.from(i.hash).toString("hex")}:${i.index}:${(i.sequence ?? 0xffffffff).toString(16)}`,
      );
    const outs = (p: Psbt) =>
      p.txOutputs.map((o) => `${Buffer.from(o.script).toString("hex")}=${o.value}`);
    expect(ins(got), v.name).toEqual(ins(want));
    const w = outs(want);
    if (Buffer.byteLength(v.memo) > 75 && want.txOutputs.length === 3) {
      const c = want.txOutputs[1]!;
      w[1] = `${Buffer.from(c.script).toString("hex")}=${c.value - BigInt(v.feeRate)}`;
      if (outs(got)[1] !== outs(want)[1]) memoShift++;
    }
    if (JSON.stringify(outs(got)) !== JSON.stringify(w)) diffs.push(v.name);
    // witness_utxo present on every input (signable by any wallet without the prev tx)
    expect(
      got.data.inputs.every((i) => i.witnessUtxo),
      v.name,
    ).toBe(true);
  }
  return { diffs, memoShift };
}
describe("buildPsbtWithMemo (wasm) vs the old btc.ts builder", () => {
  it("151-vector corpus: identical except the +1 vB memo>75B fee", () => {
    const vs = load("psbt-memo-corpus.json");
    expect(vs.length).toBe(151);
    const r = compare(vs);
    expect(r.diffs).toEqual([]);
    expect(r.memoShift).toBeGreaterThan(0);
  });
  it("60 random vectors: identical except the +1 vB memo>75B fee; short-of-funds still refused", () => {
    const vs = load("psbt-memo-60.json");
    expect(vs.length).toBe(60);
    expect(compare(vs).diffs).toEqual([]);
  });
});
