import { beforeEach, describe, expect, it } from "vitest";
import { bigJson, btDetect } from "./blocktools.js";
import { recognisedOnly } from "./ledgers.js";
import {
  COINS,
  type Coin,
  cashToLegacy,
  coinsOf,
  convert,
  GRS_XPUB_PACE,
  outputScript,
  parseZecV5,
  utxoSources,
  utxoSweep,
} from "./utxochains.js";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
// Groestlcoin/eclair f52fbf9: same payload with the Groestl-512 checksum (+) and the sha256d checksum (-)
const GRS_TPUB =
  "tpubDMBn7xW1g1Gsok5eThkJAKJnB3ZFqZQnvsdWv8VvM3RjZkqVPZZpjPDAAmbyDHnZPdAZY8EnFBh1ibTBtiuDqb8t9wRcAZiFihma41vfyVK";
const SHA_TPUB =
  "tpubDMBn7xW1g1Gsok5eThkJAKJnB3ZFqZQnvsdWv8VvM3RjZkqVPZZpjPDAAmbyDHnZPdAZY8EnFBh1ibTBtiuDqb8t9wRcAZiFihma3yYRG1f";
// BIP341 vector re-encoded with the grs hrp
const GRS1P = "grs1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dpsm7geds";
const XMR =
  "44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A";

describe("bigJson keeps amounts above 2^53 exact", () => {
  it("quotes 16+ digit integers only", () => {
    const r = bigJson<{ a: string; b: number; c: string[] }>(
      '{"a":33979404789171954,"b":5,"c":[12345678901234567]}',
    );
    expect(r).toEqual({ a: "33979404789171954", b: 5, c: ["12345678901234567"] });
  });
});

describe("ZEC transparent sweep (blocktools zcash-v5, independently parsed)", () => {
  const a = convert(BTC, "zec")!;
  const fz = (branch = "37a5165b") =>
    (async (u: string) =>
      u.endsWith("/api/v2")
        ? json({ backend: { consensus: { chaintip: branch, nextblock: branch } } })
        : json([
            { txid: "ab".repeat(32), vout: 1, value: "125000000", confirmations: 500 },
            { txid: "cd".repeat(32), vout: 0, value: "999", coinbase: true, confirmations: 16 },
          ])) as unknown as typeof fetch;
  it("builds a v5 tx with the live branch id, skipping immature coinbase", async () => {
    const s = (await utxoSweep(fz(), "zec", a, a)) as Awaited<ReturnType<typeof utxoSweep>> & {
      zcash?: { branchId: string };
      txFormat?: string;
    };
    expect(s.txFormat).toBe("zcash-v5");
    expect(s.zcash?.branchId).toBe("37a5165b");
    const t = parseZecV5(s.unsignedTx)!;
    expect(t.branchId).toBe("37a5165b");
    expect(t.ins.map((i) => i.txid)).toEqual(["ab".repeat(32)]);
    expect(t.outs[0]!.script.equals(outputScript(a, "zec"))).toBe(true);
    expect(BigInt(s.amount) + BigInt(s.fee)).toBe(125000000n);
    expect(BigInt(s.fee)).toBeGreaterThanOrEqual(10000n); // ZIP-317 minimum (2 logical actions)
  });
  it("refuses when the explorer's branch id differs from blocktools'", async () => {
    await expect(utxoSweep(fz("c8e71055"), "zec", a, a)).rejects.toThrow();
  });
  it("refuses non-P2PKH (t3) addresses", async () => {
    await expect(utxoSweep(fz(), "zec", "t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd", a)).rejects.toThrow(
      /P2PKH/,
    );
  });
  it("parseZecV5 rejects a v4 header and trailing bytes", () => {
    expect(parseZecV5("04000080")).toBeNull();
  });
});

describe("XPM / AUR / TRC sweeps on measured rates", () => {
  for (const [k, rate] of [
    ["aur", 103],
    ["trc", 15],
  ] as [Coin, number][]) {
    it(`${k} at ${rate}`, async () => {
      expect(COINS[k].feeRate).toBe(rate);
      expect(COINS[k].sweep).toBe(true);
      const prev = process.env.CRYPTOID_API_KEY;
      process.env.CRYPTOID_API_KEY = "k";
      try {
        const f = (async () =>
          json(
            k === "trc"
              ? [
                  {
                    txid: "ab".repeat(32),
                    vout: 1,
                    satoshis: 5000000000,
                    amount: 50,
                    confirmations: 9,
                  },
                ]
              : {
                  unspent_outputs: [
                    {
                      tx_hash: "ab".repeat(32),
                      tx_ouput_n: 1,
                      value: 5000000000,
                      confirmations: 9,
                    },
                  ],
                },
          )) as unknown as typeof fetch;
        const a = convert(BTC, k)!;
        const s = await utxoSweep(f, k, a, a);
        expect(BigInt(s.amount) + BigInt(s.fee)).toBe(
          k === "xpm" || k === "aur" ? 5000000000n : 5000000000n,
        );
      } finally {
        if (prev === undefined) delete process.env.CRYPTOID_API_KEY;
        else process.env.CRYPTOID_API_KEY = prev;
      }
    });
  }
  it("XPM stays off: blocktools caps fee_rate at 2000", () => {
    expect(COINS.xpm.sweep).toBeFalsy();
  });
  it("WDC and QRK stay off", () => {
    expect(COINS.wdc.sweep).toBeFalsy();
    expect(COINS.qrk.sweep).toBeFalsy();
  });
});

describe("Groestlcoin xpub and grs1p", () => {
  beforeEach(() => Object.assign(GRS_XPUB_PACE, { gapMs: 0, backoffMs: 1 }));
  it("a Groestl-checksum xpub is GRS; the sha256d twin is not", () => {
    expect(coinsOf(GRS_TPUB)).toEqual(["grs"]);
    expect(coinsOf(SHA_TPUB)).toEqual([]);
  });
  it("grs1p is detected as GRS but sweeping it is refused", async () => {
    expect(btDetect(GRS1P)).toEqual(["grs"]);
    expect(coinsOf(GRS1P)).toEqual(["grs"]);
    await expect(utxoSweep(fetch, "grs", GRS1P, GRS1P)).rejects.toThrow(/taproot/);
  });
  it("xpub scan is paced: 429s are retried, never more than 2 in flight", async () => {
    Object.assign(GRS_XPUB_PACE, { gapMs: 0, backoffMs: 1 });
    let inFlight = 0,
      peak = 0,
      calls = 0;
    const f = (async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return ++calls % 3 === 0 ? new Response("", { status: 429 }) : json({ balance: "0" });
    }) as unknown as typeof fetch;
    const { sources } = utxoSources(f, GRS_TPUB);
    expect(sources[0]!.ms).toBe(30_000);
    expect(await sources[0]!.run()).toEqual([]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(calls).toBeGreaterThan(45);
    const always429 = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(utxoSources(always429, GRS_TPUB).sources[0]!.run()).rejects.toThrow(
      /45 of 45 xpub addresses unanswered/,
    );
  });
  it("xpub scan checks 45 derived addresses and offers no sweep for taproot", async () => {
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      if (u.includes("grs1p")) return json({ balance: "100000000" });
      return json({ balance: "0" });
    }) as unknown as typeof fetch;
    const { sources } = utxoSources(f, GRS_TPUB);
    expect(sources).toHaveLength(1);
    const items = (await sources[0]!.run()) as { what: string; sweep?: unknown }[];
    expect(seen.filter((u) => u.includes("/address/")).length).toBe(45);
    expect(items).toHaveLength(15);
    expect(items.every((i) => !i.sweep && /45 addresses checked/.test(i.what))).toBe(true);
  });
});

describe("Monero: public classify only", () => {
  it("recognised, no balance source", () => {
    expect(btDetect(XMR)).toEqual(["xmr"]);
    expect(recognisedOnly(XMR)).toEqual(["xmr"]);
  });
});

describe("BCH CashAddr destination", () => {
  // CashAddr spec test vectors (bitcoincashorg/spec cashaddr.md)
  it("decodes to legacy with checksum", () => {
    expect(cashToLegacy("bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a")).toBe(
      "1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu",
    );
    expect(cashToLegacy("ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq")).toBe(
      "3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC",
    );
    expect(cashToLegacy("bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6b")).toBeNull();
  });
  it("sweep accepts a cashaddr to and from", async () => {
    const f = (async () =>
      json([{ txid: "ab".repeat(32), vout: 0, value: "100000000" }])) as unknown as typeof fetch;
    const s = await utxoSweep(
      f,
      "bch",
      "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
      "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
    );
    expect(s.to).toBe("1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu");
  });
});
