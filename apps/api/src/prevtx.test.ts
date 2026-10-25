import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { fetchPrevTxs, matchTxid, PREV_LIMITS, resetPrevTxCache, txidOfRaw } from "./prevtx.js";
import { fakePrev, prevUtxos, withPrev } from "./testkit/prevfix.js";
import { convert, utxoSweep } from "./utxochains.js";

const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const json = (v: unknown) => new Response(JSON.stringify(v));
const bb = { type: "blockbook" as const, urls: ["https://bb.example"] };

describe("prev_tx fetch (legacy input amount proof)", () => {
  it("txid = double SHA-256 reversed; Groestlcoin single SHA-256", () => {
    const d = fakePrev("doge", convert(BTC, "doge")!, 1000n);
    expect(txidOfRaw(d.hex)).toBe(d.txid);
    const g = fakePrev("grs", "Fr5m2irs9vNWSAFXJK6KPtxqW9YWg384FX", 1000n);
    expect(txidOfRaw(g.hex, true)).toBe(g.txid);
    expect(txidOfRaw(g.hex)).not.toBe(g.txid);
  });
  it("witness-serialized prev tx (explorers return it for LTC): matched by its non-witness txid, passed stripped", async () => {
    const t = new Transaction();
    t.version = 2;
    t.addInput(Buffer.alloc(32, 7), 1);
    t.setWitness(0, [Buffer.alloc(71, 1), Buffer.alloc(33, 2)]);
    t.addOutput(Buffer.from("76a914" + "11".repeat(20) + "88ac", "hex"), 12345n as never);
    const full = t.toHex();
    expect(t.hasWitnesses()).toBe(true);
    expect(txidOfRaw(full)).not.toBe(t.getId());
    const m = matchTxid(full, t.getId());
    const bare = t.clone();
    bare.ins[0]!.witness = [];
    expect(m).toBe(bare.toHex());
    expect(matchTxid(full, "00".repeat(32))).toBeNull();
    resetPrevTxCache();
    const r = await fetchPrevTxs(
      (async () => json({ hex: full })) as unknown as typeof fetch,
      "ltc",
      bb,
      [t.getId()],
    );
    expect(r.got.get(t.getId())).toBe(m);
  });
  it("dedupes txids, checks the hash, and rejects a tx whose hash differs", async () => {
    resetPrevTxCache();
    const a = fakePrev("doge", convert(BTC, "doge")!, 1000n, 0, 1);
    const b = fakePrev("doge", convert(BTC, "doge")!, 2000n, 0, 2);
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(u);
      // b's endpoint answers with a's bytes: a lying explorer
      return json({ hex: u.includes(a.txid) ? a.hex : a.hex });
    }) as unknown as typeof fetch;
    const r = await fetchPrevTxs(f, "doge", bb, [a.txid, a.txid, b.txid]);
    expect(calls.length).toBe(2);
    expect(r.got.get(a.txid)).toBe(a.hex);
    expect(r.failed.get(b.txid)).toMatch(/hash does not match/);
  });
  it("caps a single tx at 400 KB", async () => {
    resetPrevTxCache();
    const f = (async () =>
      json({ hex: "00".repeat(PREV_LIMITS.maxTxBytes + 10) })) as unknown as typeof fetch;
    const r = await fetchPrevTxs(f, "doge", bb, ["11".repeat(32)]);
    expect(r.failed.get("11".repeat(32))).toMatch(/too large|400 KB/);
  });
  it("cryptoid sources have no raw tx: every txid fails without a request", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return json({});
    }) as unknown as typeof fetch;
    const r = await fetchPrevTxs(f, "xpm", { type: "cryptoid", urls: ["x"] }, ["22".repeat(32)]);
    expect(n).toBe(0);
    expect(r.failed.size).toBe(1);
  });
  it("adapters: insight /rawtx, qtum.info /raw-tx, WhatsOnChain /tx/{id}/hex", async () => {
    for (const [type, coin] of [
      ["insight", "mona"],
      ["qtuminfo", "qtum"],
      ["woc", "bsv"],
    ] as const) {
      resetPrevTxCache();
      const p = fakePrev(coin, convert(BTC, coin)!, 5000n);
      const r = await fetchPrevTxs(
        withPrev(new Map([[p.txid, p.hex]]), () => json({})),
        coin,
        { type, urls: ["https://x"] },
        [p.txid],
      );
      expect(r.got.get(p.txid), type).toBe(p.hex);
    }
  });
});

describe("utxoSweep with prev_tx", () => {
  const a = convert(BTC, "doge")!;
  it("drops inputs whose prev tx is unavailable when >= 90% of the value remains, with a note", async () => {
    resetPrevTxCache();
    const { utxos, prev } = prevUtxos("doge", a, ["9500000000", "400000000"]);
    prev.delete(utxos[1]!.txid);
    const s = await utxoSweep(
      withPrev(prev, () => json(utxos)),
      "doge",
      a,
      a,
    );
    expect(s.inputs.map((i) => i.txid)).toEqual([utxos[0]!.txid]);
    expect(s.note).toMatch(/1 inputs left out \(previous transaction unavailable\)/);
  });
  it("fails closed with a plain error when under 90% of the value can be proven", async () => {
    resetPrevTxCache();
    const { utxos, prev } = prevUtxos("doge", a, ["5000000000", "5000000000"]);
    prev.delete(utxos[1]!.txid);
    await expect(
      utxoSweep(
        withPrev(prev, () => json(utxos)),
        "doge",
        a,
        a,
      ),
    ).rejects.toThrow(/could not fetch the previous transactions for 1 of 2 inputs.*not built/);
  });
  it("a prev tx paying a different amount is refused by blocktools (explorer amount lie)", async () => {
    resetPrevTxCache();
    const { utxos, prev } = prevUtxos("doge", a, ["5000000000"]);
    const lie = utxos.map((u) => ({ ...u, value: "9000000000" }));
    await expect(
      utxoSweep(
        withPrev(prev, () => json(lie)),
        "doge",
        a,
        a,
      ),
    ).rejects.toThrow(/prev_tx output differs/);
  });
  it("BCH, BSV and BTG fetch prev_tx too", async () => {
    for (const k of ["bch", "bsv", "btg"] as const) {
      resetPrevTxCache();
      const from = convert(BTC, k)!;
      const { utxos, prev } = prevUtxos(k, from, ["100000000"]);
      const seen: string[] = [];
      const f = withPrev(prev, (u) => {
        seen.push(u);
        return json(
          k === "bsv"
            ? utxos.map((x) => ({ tx_hash: x.txid, tx_pos: x.vout, value: Number(x.value) }))
            : utxos,
        );
      });
      const s = await utxoSweep(f, k, from, from);
      expect(s.txFormat, k).toBe("forkid");
    }
  });
  it("segwit (P2WPKH) inputs commit to amounts: no prev tx fetched", async () => {
    resetPrevTxCache();
    const L = "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9";
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(u);
      return json([{ txid: "ab".repeat(32), vout: 0, value: "100000000" }]);
    }) as unknown as typeof fetch;
    await utxoSweep(f, "ltc", L, L, 1).catch(() => {});
    expect(calls.some((u) => u.includes("/api/v2/tx/"))).toBe(false);
  });
});
