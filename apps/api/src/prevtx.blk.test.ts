import { beforeEach, describe, expect, it } from "vitest";
import fx from "./fixtures/blk-prevtx-2src.json" with { type: "json" };
import { fetchPrevTxs, matchTxid, resetPrevTxCache } from "./prevtx.js";
import { COINS } from "./utxochains.js";

type Tx = { txid: string; iquidus: string; pbcx: { data: { txid: string; hex: string } } };
const txs = fx.txs as Tx[];
const SRCS = COINS.blk.prev!;
const by = new Map(txs.map((t) => [t.txid, t]));
const TXID = /(?:txid=|\/tx\/)([0-9a-f]{64})/;
/** fetch replaying the captured answers; `mode` lets a test break one source */
const replay =
  (mode: { iquidus?: "error" | "down" | "wrong"; pbcx?: "down" | "wrong" | "other" } = {}) =>
  async (u: string | URL) => {
    const s = String(u);
    const t = by.get(TXID.exec(s)![1]!)!;
    const other = txs.find((x) => x.txid !== t.txid)!;
    if (s.startsWith("https://mainnet.blackcoin.nl/api/getrawtransaction?")) {
      if (mode.iquidus === "down") return new Response("", { status: 502 });
      if (mode.iquidus === "error") return new Response("Error: Check your console");
      return new Response(mode.iquidus === "wrong" ? other.iquidus : t.iquidus);
    }
    if (s.startsWith("https://projectblackcoin.org/api/explorer/tx/")) {
      if (mode.pbcx === "down") return new Response("", { status: 503 });
      const b =
        mode.pbcx === "wrong"
          ? { ...t.pbcx, data: { txid: t.txid, hex: other.pbcx.data.hex } }
          : mode.pbcx === "other"
            ? other.pbcx
            : t.pbcx;
      return new Response(JSON.stringify(b));
    }
    throw new Error(`unexpected ${s}`);
  };
const ids = txs.map((t) => t.txid);
beforeEach(() => resetPrevTxCache());

describe("BLK prev-tx fixtures: both sources byte-identical after normalisation", () => {
  it(`${txs.length} txs, including a segwit coinbase`, () => {
    expect(txs.length).toBeGreaterThanOrEqual(10);
    expect(txs.some((t) => t.iquidus !== t.pbcx.data.hex)).toBe(true); // the witness-form coinbase
  });
  for (const t of txs)
    it(t.txid.slice(0, 12), () => {
      const a = matchTxid(t.iquidus, t.txid);
      const b = matchTxid(t.pbcx.data.hex, t.txid);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a).toBe(b);
      expect(t.pbcx.data.txid).toBe(t.txid);
    });
});

describe("BLK fetchPrevTxs over the two sources", () => {
  const run = (m?: Parameters<typeof replay>[0]) =>
    fetchPrevTxs(replay(m) as unknown as typeof fetch, "blk", SRCS, ids);
  it("blackcoin.nl answers: all verified, stored in txid (non-witness) form", async () => {
    const { got, failed } = await run();
    expect(failed.size).toBe(0);
    for (const t of txs) expect(got.get(t.txid)).toBe(matchTxid(t.pbcx.data.hex, t.txid));
  });
  for (const m of ["error", "down"] as const)
    it(`blackcoin.nl ${m}: falls back to projectblackcoin.org`, async () => {
      const { got, failed } = await run({ iquidus: m });
      expect(failed.size).toBe(0);
      expect(got.size).toBe(txs.length);
    });
  it("blackcoin.nl serves the wrong tx: rejected by the hash check", async () => {
    const { got, failed } = await run({ iquidus: "wrong", pbcx: "down" });
    expect(got.size).toBe(0);
    expect([...failed.values()].every((v) => /hash does not match|503/.test(v))).toBe(true);
  });
  it("projectblackcoin.org answers for another txid: refused", async () => {
    const { got, failed } = await run({ iquidus: "down", pbcx: "other" });
    expect(got.size).toBe(0);
    expect(failed.size).toBe(txs.length);
  });
  it("both wrong: nothing verified (fail closed)", async () => {
    const { got } = await run({ iquidus: "wrong", pbcx: "wrong" });
    expect(got.size).toBe(0);
  });
  it("both down: nothing verified", async () => {
    const { got, failed } = await run({ iquidus: "down", pbcx: "down" });
    expect(got.size).toBe(0);
    expect(failed.size).toBe(txs.length);
  });
});
