import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import {
  COINS,
  type Coin,
  coinsOf,
  convert,
  decodeFor,
  outputScript,
  resetCryptoid,
  utxoScan,
  utxoSweep,
} from "./utxochains.js";

const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const json = (v: unknown) => new Response(JSON.stringify(v));
describe("old coins: data-driven rows", () => {
  it("every row round-trips its own p2pkh encoding", () => {
    for (const k of Object.keys(COINS) as Coin[]) {
      const a = convert(BTC, k);
      if (k === "grs") {
        expect(a).toBeNull();
        continue;
      }
      expect(decodeFor(a!, k)?.kind).toBe("p2pkh");
    }
  });
  it("BTC-shaped addresses are never claimed as a native coin", () => {
    expect(coinsOf(BTC)).toEqual([]);
    expect(coinsOf("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toEqual([]);
  });
  it("returns every candidate when version bytes collide", () => {
    expect(coinsOf(convert(BTC, "dgb")!)).toEqual(expect.arrayContaining(["doge", "dgb"]));
    expect(coinsOf(convert(BTC, "via")!)).toEqual(expect.arrayContaining(["vtc", "via"]));
    expect(coinsOf(convert(BTC, "mona")!)).toEqual(
      expect.arrayContaining(["mona", "ltc", "qtum", "mec"]),
    );
    expect(coinsOf(convert(BTC, "xpm")!)).toEqual(expect.arrayContaining(["xpm", "aur", "anc"]));
    expect(coinsOf(convert(BTC, "dash")!)).toEqual(["dash"]);
    expect(convert(BTC, "zec")!.startsWith("t1")).toBe(true);
    expect(coinsOf(convert(BTC, "zec")!)).toEqual(["zec"]);
    expect(coinsOf("FfgZPEfmvou5VxZRnTbRjPKhgVsrx7Qjq9")).toEqual(["grs"]);
  });
  it("uses each coin's decimals (Peercoin = 6)", async () => {
    const f = (async (u: string) =>
      u.includes("llama")
        ? json({ coins: {} })
        : json({ balance: "2500000", unconfirmedBalance: "0" })) as unknown as typeof fetch;
    const r = await utxoScan(f, convert(BTC, "ppc")!, {});
    const ppc = r.items.find((i) => (i as { what: string }).what.includes("PPC"))!;
    expect((ppc as { what: string }).what).toMatch(/^2\.5 PPC/);
    expect((ppc as { sweep?: unknown }).sweep).toBeUndefined();
  });
  it("BTC scan: no-source coins are listed as not checked; slow coins time out on their own line", async () => {
    const f = (async (u: string) => {
      if (u.includes("dash")) return new Promise(() => {});
      return u.includes("llama") ? json({ coins: {} }) : new Response("x", { status: 500 });
    }) as unknown as typeof fetch;
    const r = await utxoScan(f, BTC, {}, 200);
    expect(r.notChecked).toEqual(
      expect.arrayContaining([
        "Namecoin: no working public explorer (not checked)",
        "Dash: not checked (timed out after 0.2s)",
      ]),
    );
  }, 30_000);
  it("adapters: insight, qtum.info, WhatsOnChain, cryptoid multiaddr (keyed)", async () => {
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      if (u.includes("llama")) return json({ coins: { "coingecko:monacoin": { price: 0.1 } } });
      if (u.includes("insight")) return json({ balanceSat: 100000000, unconfirmedBalanceSat: 0 });
      if (u.includes("qtum.info")) return json({ balance: "300000000", unconfirmed: "0" });
      if (u.includes("whatsonchain")) return json({ confirmed: 5, unconfirmed: 0 });
      if (u.includes("cryptoid"))
        return json({ addresses: [{ address: convert(BTC, "xpm"), final_balance: 700000000 }] });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const m = await utxoScan(f, convert(BTC, "mona")!, {});
    expect(
      m.items.some(
        (i) =>
          /^1 MONA/.test((i as { what: string }).what) &&
          (i as { valueUsd: number }).valueUsd === 0.1,
      ),
    ).toBe(true);
    expect(m.items.some((i) => /^3 QTUM/.test((i as { what: string }).what))).toBe(true);
    resetCryptoid();
    const x = await utxoScan(f, convert(BTC, "xpm")!, { CRYPTOID_API_KEY: "k" });
    expect(x.items.some((i) => /^7 XPM/.test((i as { what: string }).what))).toBe(true);
    expect(seen.some((u) => u.includes("q=multiaddr"))).toBe(true);
  });
});
describe("old coins: unsigned sweeps", () => {
  const utx = [{ txid: "ab".repeat(32), vout: 1, value: "100000000" }];
  for (const k of ["dash", "dgb", "rvn", "vtc", "via", "qtum", "mona", "bsv"] as Coin[]) {
    it(`${k}: legacy tx, one output paying the ${k} destination`, async () => {
      const f = (async (u: string) =>
        json(
          u.includes("qtum.info")
            ? utx.map((x) => ({ transactionId: x.txid, outputIndex: x.vout, value: x.value }))
            : u.includes("insight")
              ? utx.map((x) => ({ txid: x.txid, vout: x.vout, satoshis: Number(x.value) }))
              : u.includes("whatsonchain")
                ? utx.map((x) => ({ tx_hash: x.txid, tx_pos: x.vout, value: Number(x.value) }))
                : utx,
        )) as unknown as typeof fetch;
      const a = convert(BTC, k)!;
      const s = await utxoSweep(f, k, a, a);
      const tx = Transaction.fromHex(s.unsignedTx);
      expect(tx.ins.length).toBe(1);
      expect(Buffer.from(tx.ins[0]!.hash).reverse().toString("hex")).toBe("ab".repeat(32));
      expect(Buffer.from(tx.outs[0]!.script).equals(outputScript(a, k))).toBe(true);
      expect(BigInt(tx.outs[0]!.value) + BigInt(s.fee)).toBe(100000000n);
    });
  }
  it("refuses PoS / Zcash / Groestl / unverified formats", async () => {
    for (const k of ["ppc", "rdd", "zec", "grs", "xpm", "clam"] as Coin[])
      await expect(utxoSweep(fetch, k, "x", "y")).rejects.toThrow(/does not build/);
  });
});
