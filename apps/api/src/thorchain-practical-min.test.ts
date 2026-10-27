import { BITCOIN_CASH, DOGECOIN, LITECOIN, NON_EVM, type QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import type { GuardCtx } from "./guard/ctx.js";
import { createApp } from "./index.js";
import type { Pricer } from "./pricing.js";
import { AMOUNT_INVALID, thorchain } from "./providers/thorchain.js";
import { RouteRefused } from "./utxodest.js";

// Live read-only replies (liquify thornode gateway, X.X -> ETH.ETH, no refund/affiliate), 2026-10-27:
//   LTC 100000 sats       -> 400 "amount less than min swap amount (recommended_min_amount_in: 1625907): invalid request"
//   LTC 200000 (production) -> 400 "emit asset 0 less than price limit"
//   LTC 10^30             -> 400 "failed to simulate swap: failed to simulate handler: fail swap, invalid amount: invalid request"
//   DOGE 10 DOGE ok, recommended_min_amount_in 1257732759 (12.58 DOGE); BCH 0.01 ok, 288450 (0.0028845 BCH)
const err = (message: string) => ({ code: 3, message, details: [] });
const MINSWAP = err(
  "amount less than min swap amount (recommended_min_amount_in: 1625907): invalid request",
);
const PRICE_LIMIT = err("emit asset 0 less than price limit: invalid request");
const INVALID = err(
  "failed to simulate swap: failed to simulate handler: fail swap, invalid amount: invalid request",
);
const ETH_TO = "0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b";
const LTC_TAKER = "LMUQpY3qDP8JE2Wwa4BukGXK5cULwo7mqx";
const VAULT: Record<string, string> = {
  LTC: "ltc1q8c37s9sq89v55vuffajkfcd3xj9m67sq3r2zcjktw0h2a4vuqzws4u8fax",
  DOGE: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
  BCH: "qq07d3s9k4u8x7n5c9dzzd9prh5ryedhxqrxsjrpmg",
};
const DUST: Record<string, string> = { LTC: "100000", DOGE: "100000000", BCH: "10000" };
/** replies: one per quote call, in order (object = 400 error body; string|null = success with that recommended min). */
const net = (...replies: (object | string | null)[]) => {
  let i = 0;
  const f = (async (url: string) => {
    if (url.endsWith("/pools")) return Response.json([]);
    if (url.includes("/thorname/")) return Response.json({ error: "no" }, { status: 400 });
    if (url.endsWith("/inbound_addresses"))
      return Response.json(
        Object.entries(VAULT).map(([chain, address]) => ({
          chain,
          address,
          halted: false,
          dust_threshold: DUST[chain],
        })),
      );
    const u = new URL(url);
    const reply = replies[Math.min(i++, replies.length - 1)];
    if (reply && typeof reply === "object") return Response.json(reply, { status: 400 });
    const from = u.searchParams.get("from_asset")!.split(".")[0]!;
    return Response.json({
      inbound_address: VAULT[from],
      memo: `=:e:${u.searchParams.get("destination")}:1/1/0`,
      expected_amount_out: "38000000",
      expiry: 2_000_000_000,
      dust_threshold: DUST[from],
      ...(reply ? { recommended_min_amount_in: reply } : {}),
      fees: { asset: "ETH.ETH", affiliate: "0", outbound: "0", liquidity: "0", total: "0" },
    });
  }) as unknown as typeof fetch;
  return f;
};
const pricer: Pricer = {
  token: async (c) => ({ priceUsd: 100, decimals: c === 1 ? 18 : 8 }),
  usd: async () => 1,
};
const env = { SWAPCHAN_FEE_BPS: "10" } as NodeJS.ProcessEnv;
const sig = () => AbortSignal.timeout(2000);
const reqOf = (from: number, amount: bigint | string, taker?: string): QuoteRequest =>
  ({
    fromChainId: from,
    fromToken: NON_EVM[from]!.native,
    toChainId: 1,
    toToken: "0x0000000000000000000000000000000000000000",
    amount: amount.toString(),
    slippageBps: 100,
    recipient: ETH_TO,
    ...(taker ? { taker } : {}),
  }) as QuoteRequest;
const TAKER: Record<number, string> = {
  [LITECOIN]: LTC_TAKER,
  [DOGECOIN]: "D8XhvXbJYovhJN7X51qkrYACDX29vBamQF",
  [BITCOIN_CASH]: "qr086xmjrg0qvv4heuzwmagr9j8vl75lng5q0hkfz5",
};
const HUGE = (10n ** 30n).toString();

describe("THORChain errors: price limit and invalid amount", () => {
  it("price limit with no number seen -> below minimum at our floor (deposit and PSBT quote)", async () => {
    for (const run of [
      (t: ReturnType<typeof thorchain>) => t.deposit(reqOf(LITECOIN, 200_000n), undefined, sig()),
      (t: ReturnType<typeof thorchain>) => t.quote(reqOf(LITECOIN, 200_000n, LTC_TAKER), sig()),
    ]) {
      const p = run(thorchain(pricer, env, net(PRICE_LIMIT)));
      await expect(p).rejects.toBeInstanceOf(RouteRefused);
      await expect(p).rejects.toThrow("below minimum: send at least 0.001 LTC");
    }
  });
  it("price limit after THORChain gave its recommended minimum -> that number", async () => {
    const t = thorchain(pricer, env, net(MINSWAP, PRICE_LIMIT));
    await expect(t.deposit(reqOf(LITECOIN, 100_000n), undefined, sig())).rejects.toThrow(
      "below minimum: send at least 0.01625907 LTC",
    );
    await expect(t.deposit(reqOf(LITECOIN, 200_000n), undefined, sig())).rejects.toThrow(
      "below minimum: send at least 0.01625907 LTC",
    );
  });
  it("invalid amount (10^30) -> amount invalid or too large", async () => {
    for (const run of [
      (t: ReturnType<typeof thorchain>) => t.deposit(reqOf(LITECOIN, HUGE), undefined, sig()),
      (t: ReturnType<typeof thorchain>) => t.quote(reqOf(LITECOIN, HUGE, LTC_TAKER), sig()),
    ]) {
      const p = run(thorchain(pricer, env, net(INVALID)));
      await expect(p).rejects.toBeInstanceOf(RouteRefused);
      await expect(p).rejects.toThrow(AMOUNT_INVALID);
    }
  });
  for (const m of [
    "trading is halted for LTC",
    "pool does not exist",
    "insufficient liquidity",
    "emit asset 1234 less than price limit 5678",
  ])
    it(`stays unmapped: ${m}`, async () => {
      const p = thorchain(pricer, env, net(err(m))).deposit(
        reqOf(LITECOIN, 10n ** 8n),
        undefined,
        sig(),
      );
      await expect(p).rejects.toThrow();
      await expect(p).rejects.not.toBeInstanceOf(RouteRefused);
      await expect(p).rejects.not.toThrow(/below minimum|invalid or too large/);
    });
});

describe("practicalMinimum up front", () => {
  const cases: [string, number, bigint, string, string, string][] = [
    ["LTC", LITECOIN, 10n ** 8n, "1625907", "0.01625907", "0.01625907"],
    ["DOGE", DOGECOIN, 10n ** 9n, "1257732759", "12.57732759", "12.57732759"],
    ["BCH", BITCOIN_CASH, 1_000_000n, "288450", "0.0028845", "0.0028845"],
  ];
  for (const [sym, chain, amt, rec, disp, shown] of cases)
    it(`${sym}: deposit and PSBT quote carry THORChain's estimate; minimumDisplay is the larger`, async () => {
      const d = await thorchain(pricer, env, net(rec)).deposit(reqOf(chain, amt), undefined, sig());
      expect(d.minimum).toBe(DUST[sym]);
      expect(d.practicalMinimum?.amount).toBe(rec);
      expect(d.practicalMinimum?.display).toBe(disp);
      expect(d.practicalMinimum?.note).toMatch(/current estimate.*changes/);
      expect(d.minimumDisplay).toBe(shown);
      const q = await thorchain(pricer, env, net(rec)).quote(
        reqOf(chain, amt, TAKER[chain]),
        sig(),
      );
      expect(q.practicalMinimum?.amount).toBe(rec);
    });
  it("no recommended value -> floor shown, nothing claimed as practical", async () => {
    const d = await thorchain(pricer, env, net(null)).deposit(
      reqOf(LITECOIN, 10n ** 8n),
      undefined,
      sig(),
    );
    expect(d.practicalMinimum).toBeNull();
    expect(d.minimumDisplay).toBe("0.001");
    const q = await thorchain(pricer, env, net(null)).quote(
      reqOf(LITECOIN, 10n ** 8n, LTC_TAKER),
      sig(),
    );
    expect(q.practicalMinimum).toBeNull();
  });
  it("a practical minimum below the floor never lowers minimumDisplay", async () => {
    const d = await thorchain(pricer, env, net("5000")).deposit(
      reqOf(LITECOIN, 10n ** 8n),
      undefined,
      sig(),
    );
    expect(d.minimumDisplay).toBe("0.001");
    expect(d.practicalMinimum?.amount).toBe("5000");
  });
});

describe("HTTP: /utxo/deposit maps THORChain refusals to 400", () => {
  const ctx = (): GuardCtx => ({
    thorInbound: async () => [] as never,
    relay: async () => ({ contracts: [], solvers: [] }),
    zeroxSettlers: async () => [],
  });
  const post = (f: typeof fetch, amount: bigint | string) =>
    createApp([thorchain(pricer, env, f)], { pricer: null, guard: ctx(), simulator: null }).request(
      "/utxo/deposit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqOf(LITECOIN, amount)),
      },
    );
  it("LTC 200000 sats, price limit -> 400 below minimum", async () => {
    const r = await post(net(PRICE_LIMIT), 200_000n);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/^below minimum: send at least /);
  });
  it("10^30 -> 400 amount invalid or too large", async () => {
    const r = await post(net(INVALID), HUGE);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe(AMOUNT_INVALID);
  });
  it("success carries practicalMinimum", async () => {
    const r = await post(net("1625907"), 10n ** 8n);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.practicalMinimum.display).toBe("0.01625907");
    expect(j.minimumDisplay).toBe("0.01625907");
  });
});
