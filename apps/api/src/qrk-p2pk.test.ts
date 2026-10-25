import { describe, expect, it } from "vitest";
import { COINS, convert, resetCryptoid, utxoSources, utxoSweep } from "./utxochains.js";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const withKey = async <T>(fn: () => Promise<T>) => {
  resetCryptoid();
  const prev = process.env.CRYPTOID_API_KEY;
  process.env.CRYPTOID_API_KEY = "k";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CRYPTOID_API_KEY;
    else process.env.CRYPTOID_API_KEY = prev;
  }
};
const cidF = (rows: { value: number; script?: string }[]) =>
  (async () =>
    json({
      unspent_outputs: rows.map((r, i) => ({
        tx_hash: (i + 10).toString(16).padStart(2, "0").repeat(32),
        tx_ouput_n: 0,
        confirmations: 50,
        ...r,
      })),
    })) as unknown as typeof fetch;

describe("QRK sweeps: off (cryptoid has no raw-transaction endpoint for prev_tx)", () => {
  const a = convert(BTC, "qrk")!;
  it("refuses with the plain note before any UTXO fetch", () =>
    withKey(async () => {
      let n = 0;
      const f = (async () => {
        n++;
        return new Response("{}");
      }) as unknown as typeof fetch;
      await expect(utxoSweep(f, "qrk", a, a)).rejects.toThrow(
        "balance found; sweeping this coin isn't available yet - use the coin's own wallet (Quark Core).",
      );
      expect(n).toBe(0);
    }));
});

describe("cryptoid-only coins: balance shown, no sweep offered", () => {
  for (const k of ["qrk", "xpm", "aur", "nvc", "clam", "blk"] as const) {
    it(`${k}: scan row has a balance, no sweep, and the plain note`, async () => {
      expect(COINS[k].sweep).toBe(false);
      resetCryptoid();
      const a = convert(BTC, k)!;
      const f = (async (u: string | URL) =>
        String(u).includes("coingecko")
          ? new Response("{}")
          : new Response("12.5")) as unknown as typeof fetch;
      const { sources } = utxoSources(f, a, {});
      const rows = (await sources.find((x) => x.coin === k)!.run()) as {
        sweep?: unknown;
        action: string;
        what: string;
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.what).toMatch(/^12\.5 /);
      expect(rows[0]!.sweep).toBeUndefined();
      expect(rows[0]!.action).toContain(
        "balance found; sweeping this coin isn't available yet - use the coin's own wallet",
      );
    });
  }
});
