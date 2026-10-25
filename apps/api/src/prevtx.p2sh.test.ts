import { describe, expect, it } from "vitest";
import { btSweep } from "./blocktools.js";
import { resetPrevTxCache } from "./prevtx.js";
import { prevUtxos, withPrev } from "./testkit/prevfix.js";
import { type Coin, convert, utxoSweep } from "./utxochains.js";

// blocktools 2052b30: bare P2SH is not amount-committed (it may wrap any legacy script), so it needs prev_tx unless
// a witness-program redeem_script proves wrapped segwit. SwapChan never has the redeem script, so it fetches prev_tx.
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const json = (v: unknown) => new Response(JSON.stringify(v));

describe("P2SH sweep inputs need prev_tx (blocktools 2052b30)", () => {
  for (const k of ["doge", "ltc", "bch", "dash"] as Coin[]) {
    it(`${k}: P2SH from-address fetches prev_tx (hash-checked) and builds`, async () => {
      resetPrevTxCache();
      const from = convert(P2SH, k);
      expect(from, k).toBeTruthy();
      const to = convert("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", k)!;
      const { utxos, prev } = prevUtxos(k, from!, ["500000000", "300000000"]);
      const raw: string[] = [];
      const f = withPrev(prev, (u) => {
        raw.push(u);
        return json(utxos);
      });
      const s = await utxoSweep(f, k, from!, to);
      expect(s.inputs.length).toBe(2);
      expect(BigInt(s.amount)).toBeGreaterThan(0n);
    });
  }
  it("P2SH with no prev tx available: fails closed, nothing built", async () => {
    resetPrevTxCache();
    const from = convert(P2SH, "doge")!;
    const { utxos } = prevUtxos("doge", from, ["500000000"]);
    await expect(
      utxoSweep(
        withPrev(new Map(), () => json(utxos)),
        "doge",
        from,
        from,
      ),
    ).rejects.toThrow(/could not fetch the previous transactions for 1 of 1 inputs.*not built/);
  });
  it("P2SH prev tx paying a different amount is refused (explorer amount lie)", async () => {
    resetPrevTxCache();
    const from = convert(P2SH, "doge")!;
    const { utxos, prev } = prevUtxos("doge", from, ["500000000"]);
    const lie = utxos.map((u) => ({ ...u, value: "900000000" }));
    await expect(
      utxoSweep(
        withPrev(prev, () => json(lie)),
        "doge",
        from,
        from,
      ),
    ).rejects.toThrow(/prev_tx output differs/);
  });
  it("blocktools itself refuses a bare P2SH input without prev_tx", () => {
    const from = convert(P2SH, "doge")!;
    const { utxos, prev } = prevUtxos("doge", from, ["500000000"]);
    const u = { txid: utxos[0]!.txid, vout: 0, amount: "500000000", address: from };
    expect(() => btSweep("doge", [u], from, 1000)).toThrow(/legacy_input_needs_prev_tx/);
    expect(btSweep("doge", [{ ...u, prev_tx: prev.get(u.txid) }], from, 1000)?.psbt).toBeTruthy();
  });
});
