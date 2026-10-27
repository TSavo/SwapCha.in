import { BITCOIN_CASH, DOGECOIN, LITECOIN, NON_EVM, type QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import type { GuardCtx } from "./guard/ctx.js";
import { createApp } from "./index.js";
import type { Pricer } from "./pricing.js";
import { thorchain, UTXO_MIN } from "./providers/thorchain.js";
import { RouteRefused } from "./utxodest.js";

// THORChain's below-minimum replies, measured read-only 2026-10-27 (liquify gateway, LTC.LTC -> ETH.ETH):
//   amount=5000   -> 400 {"code":3,"message":"amount less than dust threshold: invalid request"}
//   amount=100000 -> 400 {"code":3,"message":"amount less than min swap amount (recommended_min_amount_in: 1625907): invalid request"}
// inbound_addresses dust_threshold: LTC 100000, DOGE 100000000, BCH 10000.
const DUST = { code: 3, message: "amount less than dust threshold: invalid request", details: [] };
const MINSWAP = {
  code: 3,
  message: "amount less than min swap amount (recommended_min_amount_in: 1625907): invalid request",
  details: [],
};
const ETH_TO = "0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b";
const LTC_TAKER = "LMUQpY3qDP8JE2Wwa4BukGXK5cULwo7mqx";
const net = (reply: object = DUST) => {
  const swaps: string[] = [];
  const f = (async (url: string) => {
    if (url.endsWith("/pools")) return Response.json([]);
    if (url.includes("/thorname/")) return Response.json({ error: "no" }, { status: 400 });
    if (url.endsWith("/inbound_addresses"))
      return Response.json([
        { chain: "LTC", address: "ltc1qvault", halted: false, dust_threshold: "100000" },
      ]);
    if (url.includes("/quote/swap")) swaps.push(url);
    return Response.json(reply, { status: 400 });
  }) as unknown as typeof fetch;
  return { f, swaps };
};
const pricer: Pricer = {
  token: async (c) => ({ priceUsd: 100, decimals: c === 1 ? 18 : 8 }),
  usd: async () => 1,
};
const env = { SWAPCHAN_FEE_BPS: "10" } as NodeJS.ProcessEnv;
const sig = () => AbortSignal.timeout(2000);
const reqOf = (from: number, amount: bigint, taker?: string): QuoteRequest =>
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

describe("UTXO minimum: checked before THORChain is asked", () => {
  it("per-chain minimums match inbound_addresses dust thresholds", () => {
    expect(UTXO_MIN[LITECOIN]).toBe(100_000n);
    expect(UTXO_MIN[DOGECOIN]).toBe(100_000_000n);
    expect(UTXO_MIN[BITCOIN_CASH]).toBe(10_000n);
  });
  const cases: [string, number, bigint, RegExp][] = [
    ["LTC 0.00005", LITECOIN, 5_000n, /below minimum: send at least 0\.001 LTC/],
    ["DOGE 0.5", DOGECOIN, 50_000_000n, /below minimum: send at least 1 DOGE/],
    ["BCH 0.00005", BITCOIN_CASH, 5_000n, /below minimum: send at least 0\.0001 BCH/],
  ];
  for (const [name, chain, amt, re] of cases) {
    it(`deposit ${name}: RouteRefused, no quote call`, async () => {
      const m = net();
      const p = thorchain(pricer, env, m.f).deposit(reqOf(chain, amt), undefined, sig());
      await expect(p).rejects.toBeInstanceOf(RouteRefused);
      await expect(p).rejects.toThrow(re);
      expect(m.swaps).toHaveLength(0);
    });
    it(`PSBT quote ${name}: RouteRefused, no quote call`, async () => {
      const m = net();
      await expect(
        thorchain(pricer, env, m.f).quote(reqOf(chain, amt, LTC_TAKER), sig()),
      ).rejects.toThrow(re);
      expect(m.swaps).toHaveLength(0);
    });
  }
});

describe("THORChain below-minimum quote errors map to RouteRefused", () => {
  it("dust threshold (deposit and PSBT quote)", async () => {
    for (const run of [
      (t: ReturnType<typeof thorchain>) => t.deposit(reqOf(LITECOIN, 100_000n), undefined, sig()),
      (t: ReturnType<typeof thorchain>) => t.quote(reqOf(LITECOIN, 100_000n, LTC_TAKER), sig()),
    ]) {
      const p = run(thorchain(pricer, env, net(DUST).f));
      await expect(p).rejects.toBeInstanceOf(RouteRefused);
      await expect(p).rejects.toThrow("below minimum: send at least 0.001 LTC");
    }
  });
  it("min swap amount shows THORChain's recommended minimum in coin units", async () => {
    for (const run of [
      (t: ReturnType<typeof thorchain>) => t.deposit(reqOf(LITECOIN, 100_000n), undefined, sig()),
      (t: ReturnType<typeof thorchain>) => t.quote(reqOf(LITECOIN, 100_000n, LTC_TAKER), sig()),
    ]) {
      const p = run(thorchain(pricer, env, net(MINSWAP).f));
      await expect(p).rejects.toBeInstanceOf(RouteRefused);
      await expect(p).rejects.toThrow("below minimum: send at least 0.01625907 LTC");
    }
  });
  it("unrelated THORChain errors stay errors", async () => {
    const p = thorchain(pricer, env, net({ code: 3, message: "trading halted" }).f).deposit(
      reqOf(LITECOIN, 100_000n),
      undefined,
      sig(),
    );
    await expect(p).rejects.not.toBeInstanceOf(RouteRefused);
  });
});

describe("POST /utxo/deposit below minimum", () => {
  const ctx = (): GuardCtx => ({
    thorInbound: async () => [] as never,
    relay: async () => ({ contracts: [], solvers: [] }),
    zeroxSettlers: async () => [],
  });
  const post = (fetcher: typeof fetch, amount: bigint) =>
    createApp([thorchain(pricer, env, fetcher)], {
      pricer: null,
      guard: ctx(),
      simulator: null,
    }).request("/utxo/deposit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqOf(LITECOIN, amount)),
    });
  it("0.00005 LTC -> 400 with a clear message, not 500", async () => {
    const r = await post(net().f, 5_000n);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("below minimum: send at least 0.001 LTC");
  });
  it("THORChain min-swap reply -> 400, not 500", async () => {
    const r = await post(net(MINSWAP).f, 100_000n);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("below minimum: send at least 0.01625907 LTC");
  });
});
