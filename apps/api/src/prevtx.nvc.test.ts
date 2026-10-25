import { beforeEach, describe, expect, it } from "vitest";
import { blocktools } from "./blocktools.js";
import fx from "./fixtures/nvc-gettransaction.json" with { type: "json" };
import { fetchPrevTxs, resetPrevTxCache, txidOfRaw } from "./prevtx.js";

// Saved real api.novaco.in /gettransaction/<txid> answers: a coinstake (block 1106297), a plain tx and a PoS
// coinbase (double hex-encoded scriptSig). Amounts are integer base units (1 NVC = 1e6).
const txs = fx.txs as { txid: string; body: string }[];
const by = new Map(txs.map((t) => [t.txid, t.body]));
const SRC = { type: "novacoin" as const, urls: ["https://api.novaco.in"] };
const ID = /\/gettransaction\/([0-9a-f]{64})$/;
const replay = (edit?: (b: string, t: string) => string) => async (u: string | URL) => {
  const s = String(u);
  const t = ID.exec(s)?.[1];
  if (!s.startsWith("https://api.novaco.in/gettransaction/") || !t || !by.has(t))
    throw new Error(`unexpected ${s}`);
  return new Response(edit ? edit(by.get(t)!, t) : by.get(t)!);
};
const ids = txs.map((t) => t.txid);
beforeEach(() => resetPrevTxCache());

describe("NVC prev-tx via blocktools serializeNvcTxFromJson", () => {
  it("serializes all 3 saved responses to hex that hashes to the txid (independent TS hash)", () => {
    const w = blocktools()!;
    expect(txs.length).toBe(3);
    for (const { txid, body } of txs) {
      const hex = w.serializeNvcTxFromJson(body, txid);
      expect(txidOfRaw(hex)).toBe(txid);
      expect(hex.length / 2).toBe((JSON.parse(body) as { size: number }).size);
    }
  });
  it("parity: blocktools decodeTx(nvc) of the serialized hex gives the JSON's txid, inputs and output amounts", () => {
    const w = blocktools()!;
    type Row = { role: string; txid?: string; vout?: number; amount_str?: string };
    for (const { txid, body } of txs) {
      const j = JSON.parse(body) as {
        vin: { txid?: string; vout?: number; coinbase?: string }[];
        vout: { value: number }[];
      };
      const rows = JSON.parse(w.decodeTx(w.serializeNvcTxFromJson(body, txid), "nvc")) as Row[];
      expect(rows.find((r) => r.role === "summary")?.txid).toBe(txid);
      expect(rows.filter((r) => r.role === "output").map((r) => r.amount_str)).toEqual(
        j.vout.map((o) => String(o.value)),
      );
      const ins = rows.filter((r) => r.role === "input");
      expect(ins.length).toBe(j.vin.length);
      j.vin.forEach((v, k) => {
        if (!v.coinbase) expect([ins[k]!.txid, ins[k]!.vout]).toEqual([v.txid, v.vout]);
      });
    }
  });
  it("fetchPrevTxs fetches /gettransaction/<txid> and returns hash-checked hex", async () => {
    const urls: string[] = [];
    const f = (async (u: string | URL) => {
      urls.push(String(u));
      return replay()(u);
    }) as typeof fetch;
    const { got, failed } = await fetchPrevTxs(f, "nvc", [SRC], ids);
    expect(failed.size).toBe(0);
    expect(got.size).toBe(3);
    for (const t of ids) expect(txidOfRaw(got.get(t)!)).toBe(t);
    expect(urls.every((u) => ID.test(u) && !u.includes("?"))).toBe(true);
  });
  it("fails closed when an amount is altered", async () => {
    const f = replay((b) => {
      const j = JSON.parse(b) as { vout: { value: number }[] };
      j.vout[j.vout.length - 1]!.value += 1;
      return JSON.stringify(j);
    }) as typeof fetch;
    const { got, failed } = await fetchPrevTxs(f, "nvc", [SRC], ids);
    expect(got.size).toBe(0);
    expect(failed.size).toBe(3);
  });
  it("fails closed when the explorer answers for another tx, or with junk", async () => {
    const other = replay((_b, t) => by.get(ids.find((x) => x !== t)!)!) as typeof fetch;
    expect((await fetchPrevTxs(other, "nvc", [SRC], ids)).got.size).toBe(0);
    resetPrevTxCache();
    const junk = replay(() => "{}") as typeof fetch;
    const r = await fetchPrevTxs(junk, "nvc", [SRC], ids);
    expect(r.got.size).toBe(0);
    expect([...r.failed.values()].every((m) => m.startsWith("novacoin json refused"))).toBe(true);
  });
});
