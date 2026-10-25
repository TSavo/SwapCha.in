import { createHash } from "node:crypto";
import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { prevUtxos, withPrev } from "./testkit/prevfix.js";
import {
  COINS,
  type Coin,
  coinBalance,
  coinsOf,
  coinUtxos,
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
    expect((ppc as { sweep?: unknown }).sweep).toMatchObject({ kind: "utxo", coin: "ppc" });
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
describe("old coins: GRS sweep via blocktools (Groestl checksum, single-SHA-256 txid)", () => {
  it("builds, decodes and verifies one output paying the GRS destination", async () => {
    const from = "Fr5m2irs9vNWSAFXJK6KPtxqW9YWg384FX";
    const to = convert(BTC, "grs")!;
    expect(to.startsWith("F")).toBe(true);
    const { utxos, prev } = prevUtxos("grs", from, ["250000000"]);
    const f = withPrev(prev, () => json(utxos));
    const s = await utxoSweep(f, "grs", from, to, 2);
    expect(s.txFormat).toBe("legacy-sha256");
    expect(s.builtBy).toMatch(/^blocktools /);
    const tx = Transaction.fromHex(s.unsignedTx);
    expect(tx.ins.length).toBe(1);
    expect(Buffer.from(tx.ins[0]!.hash).reverse().toString("hex")).toBe(utxos[0]!.txid);
    expect(tx.outs.length).toBe(1);
    expect(Buffer.from(tx.outs[0]!.script).equals(outputScript(to, "grs"))).toBe(true);
    expect(BigInt(tx.outs[0]!.value) + BigInt(s.fee)).toBe(250000000n);
    // GRS txid = single SHA-256 (not BTC's double): bitcoinjs' getId() must differ, ours must match
    const single = createHash("sha256")
      .update(Buffer.from(s.unsignedTx, "hex"))
      .digest()
      .reverse()
      .toString("hex");
    expect((s as { verified?: { txid?: string } }).verified?.txid).toBe(single);
    expect(single).not.toBe(tx.getId());
  });
  it("rejects a non-GRS destination", async () => {
    const f = (async () => json([])) as unknown as typeof fetch;
    await expect(utxoSweep(f, "grs", "Fr5m2irs9vNWSAFXJK6KPtxqW9YWg384FX", BTC)).rejects.toThrow(
      /GRS address/,
    );
  });
});
describe("old coins: unsigned sweeps", () => {
  for (const k of ["dash", "dgb", "rvn", "vtc", "via", "qtum", "mona", "bsv"] as Coin[]) {
    it(`${k}: legacy tx, one output paying the ${k} destination`, async () => {
      const a = convert(BTC, k)!;
      const { utxos: utx, prev } = prevUtxos(k, a, ["100000000"], 1);
      const f = withPrev(prev, (u: string) =>
        json(
          u.includes("qtum.info")
            ? utx.map((x) => ({ transactionId: x.txid, outputIndex: x.vout, value: x.value }))
            : u.includes("insight")
              ? utx.map((x) => ({ txid: x.txid, vout: x.vout, satoshis: Number(x.value) }))
              : u.includes("whatsonchain")
                ? utx.map((x) => ({ tx_hash: x.txid, tx_pos: x.vout, value: Number(x.value) }))
                : utx,
        ),
      );
      const s = await utxoSweep(f, k, a, a);
      const tx = Transaction.fromHex(s.unsignedTx);
      expect(tx.ins.length).toBe(1);
      expect(Buffer.from(tx.ins[0]!.hash).reverse().toString("hex")).toBe(utx[0]!.txid);
      expect(Buffer.from(tx.outs[0]!.script).equals(outputScript(a, k))).toBe(true);
      expect(BigInt(tx.outs[0]!.value) + BigInt(s.fee)).toBe(100000000n);
      // built by blocktools and checked by its decodeTx+verifyTx before being offered (no unverified TS fallback)
      expect((s as { builtBy?: string }).builtBy).toMatch(/^blocktools /);
      expect((s as { verified?: { by: string } }).verified?.by).toBe(
        "blocktools decodeTx+verifyTx",
      );
      expect((s as { txFormat?: string }).txFormat).toBe(k === "bsv" ? "forkid" : "legacy");
    });
  }
  it("dgb: a 150-input sweep at the row fee rate passes blocktools' size-scaled verdict and the TS fee cap", async () => {
    const a = convert(BTC, "dgb")!;
    const { utxos: many, prev } = prevUtxos("dgb", a, Array(150).fill("50000000"));
    const f = withPrev(prev, () => json(many));
    const s = (await utxoSweep(f, "dgb", a, a)) as {
      fee: string;
      verified?: { warnings: string[] };
    };
    expect(BigInt(s.fee)).toBeGreaterThan(1_000_000n);
    // blocktools c05e88c has a measured DGB FeeWarn row, so this no longer warns
    expect(s.verified?.warnings).toEqual(["unsigned"]);
  });
  it("skips UTXOs too small to spend economically, largest first", async () => {
    const a = convert(BTC, "via")!;
    const { utxos: mixed, prev } = prevUtxos("via", a, ["20000", "90000000"]);
    const f = withPrev(prev, () => json(mixed));
    const s = await utxoSweep(f, "via", a, a);
    expect(s.inputs.map((i) => i.txid)).toEqual([mixed[1]!.txid]);
    const dust = (async () => json([mixed[0]])) as unknown as typeof fetch;
    await expect(utxoSweep(dust, "via", a, a)).rejects.toThrow(/too small to spend/);
  });
  it("refuses the format still off (WDC unverified)", async () => {
    for (const k of ["wdc"] as Coin[])
      await expect(utxoSweep(fetch, k, "x", "y")).rejects.toThrow(/does not build/);
  });
});
describe("old coins: cryptoid UTXO lists (keyed)", () => {
  const A = "Aass1uKyBJGeKKocrKmeznUweuYwmxQ9FW";
  it("maps unspent_outputs (cryptoid's tx_ouput_n spelling) and needs the key", async () => {
    resetCryptoid();
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      return json({
        unspent_outputs: [
          {
            tx_hash: "ef".repeat(32),
            tx_ouput_n: 3,
            value: 741860555000,
            confirmations: 9,
            addr: A,
          },
        ],
      });
    }) as unknown as typeof fetch;
    for (const k of ["xpm", "clam", "nvc", "aur", "wdc", "qrk"] as Coin[]) {
      resetCryptoid();
      const u = await coinUtxos(f, k, A, { CRYPTOID_API_KEY: "k" });
      // cryptoid reports 1e8 units for every coin; NVC has 6 decimals, QRK 5
      expect(u).toEqual([
        {
          txid: "ef".repeat(32),
          vout: 3,
          value: k === "nvc" ? "7418605550" : k === "qrk" ? "741860555" : "741860555000",
        },
      ]);
    }
    expect(seen.every((u) => u.includes("q=unspent"))).toBe(true);
    await expect(coinUtxos(f, "xpm", A, {})).rejects.toThrow(/cryptoid key/);
  });
  it("NVC (6 decimals): cryptoid's 1e8-unit balance is scaled, and a sub-precision amount is refused", async () => {
    resetCryptoid();
    const f = (async () =>
      json({
        addresses: [{ address: A, final_balance: 40596540108600 }],
      })) as unknown as typeof fetch;
    expect(await coinBalance(f, "nvc", A, { CRYPTOID_API_KEY: "k" })).toBe(405965401086n);
    resetCryptoid();
    const odd = (async () =>
      json({ addresses: [{ address: A, final_balance: 123 }] })) as unknown as typeof fetch;
    await expect(coinBalance(odd, "nvc", A, { CRYPTOID_API_KEY: "k" })).rejects.toThrow(
      /precision/,
    );
  });
  it("an address cryptoid has never seen is a measured zero, not 'no answer'", async () => {
    resetCryptoid();
    const f = (async () => json({ addresses: [], txs: [] })) as unknown as typeof fetch;
    expect(await coinBalance(f, "xpm", A, { CRYPTOID_API_KEY: "k" })).toBe(0n);
    resetCryptoid();
    const bad = (async () => json({ error: "x" })) as unknown as typeof fetch;
    await expect(coinBalance(bad, "xpm", A, { CRYPTOID_API_KEY: "k" })).rejects.toThrow(
      /bad answer/,
    );
  });
});

describe("PoS nTime sweeps (blocktools buildUnsignedSweepAt) and BLK", () => {
  const cidCoins = new Set(["nvc", "clam", "blk"]);
  for (const k of ["ppc", "nvc", "clam", "rdd", "blk"] as Coin[]) {
    it(`${k}: blocktools-built with prev_tx, verified by blocktools and the TS parser (cryptoid coins refused)`, async () => {
      resetCryptoid();
      const prev = process.env.CRYPTOID_API_KEY;
      process.env.CRYPTOID_API_KEY = "k";
      try {
        const a = convert(BTC, k)!;
        const { utxos, prev: prevTx } = prevUtxos(
          k,
          a,
          [COINS[k].decimals === 6 ? "10000000" : "1000000000"],
          1,
        );
        const f = withPrev(prevTx, () =>
          json(
            cidCoins.has(k)
              ? {
                  unspent_outputs: [
                    {
                      tx_hash: "ab".repeat(32),
                      tx_ouput_n: 1,
                      value: 1000000000,
                      confirmations: 99,
                    },
                  ],
                }
              : [
                  {
                    txid: utxos[0]!.txid,
                    vout: 1,
                    value: COINS[k].decimals === 6 ? "10000000" : "1000000000",
                  },
                ],
          ),
        );
        // cryptoid has no raw-transaction endpoint: the input amounts cannot be proven, so nothing is built
        if (cidCoins.has(k)) {
          await expect(utxoSweep(f, k, a, a)).rejects.toThrow(
            /sweeping this coin isn't available yet/,
          );
          return;
        }
        const s = (await utxoSweep(f, k, a, a)) as Awaited<ReturnType<typeof utxoSweep>> & {
          txFormat?: string;
          txTime?: number;
          builtBy?: string;
          verified?: { by: string };
        };
        expect(s.builtBy).toMatch(/^blocktools /);
        expect(s.verified?.by).toBe("blocktools decodeTx+verifyTx");
        expect(s.txFormat).toBe(k === "blk" ? "legacy" : "pos-ntime");
        const total = COINS[k].decimals === 6 ? 10000000n : 1000000000n;
        expect(BigInt(s.amount) + BigInt(s.fee)).toBe(total);
        if (k !== "blk") {
          const { parsePosTx } = await import("./utxochains.js");
          const t = parsePosTx(k, s.unsignedTx)!;
          expect(t.time).toBe(s.txTime);
          expect(t.outs[0]!.script.equals(outputScript(a, k))).toBe(true);
          expect(t.version).toBe(k === "rdd" ? 2 : 1);
        } else {
          expect(Transaction.fromHex(s.unsignedTx).outs.length).toBe(1);
        }
      } finally {
        if (prev === undefined) delete process.env.CRYPTOID_API_KEY;
        else process.env.CRYPTOID_API_KEY = prev;
      }
    });
  }
  it("parsePosTx rejects trailing bytes and a wrong layout", async () => {
    const { parsePosTx } = await import("./utxochains.js");
    const a = convert(BTC, "ppc")!;
    const { utxos, prev } = prevUtxos("ppc", a, ["10000000"], 1);
    const f = withPrev(prev, () => json(utxos));
    const s = await utxoSweep(f, "ppc", a, a);
    expect(parsePosTx("ppc", s.unsignedTx)).not.toBeNull();
    expect(parsePosTx("ppc", s.unsignedTx + "00")).toBeNull();
    expect(parsePosTx("rdd", s.unsignedTx)).toBeNull();
    expect(parsePosTx("btc", s.unsignedTx)).toBeNull();
  });
});
