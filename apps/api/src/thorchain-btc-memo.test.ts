import { BITCOIN, NON_EVM, type QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { parseThorMemo } from "./guard/index.js";
import type { Pricer } from "./pricing.js";
import { thorchain } from "./providers/thorchain.js";

// Mocked THORChain (no network). Live-measured: BTC -> ETH memo without refund is 52 bytes
// ("=:e:<0x addr>:0/1/0"); adding "/<btc refund>" makes thornode answer 400 "generated memo too long".
const ETH_DEST = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const BTC_TAKER = "bc1qe2tczyk2rw7u47kzxxee5g7ufkncdmlcpmw3pk";
const TOO_LONG = JSON.stringify({
  code: 3,
  message: "generated memo too long for source chain: invalid request",
});

type Mode = "overflow" | "always-overflow" | "refund-in-memo" | "fits";
const mock = (mode: Mode, thorname = false) => {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    if (url.endsWith("/pools")) return Response.json([]);
    if (url.includes("/thorname/"))
      return thorname
        ? Response.json({ aliases: [{ chain: "THOR" }] })
        : Response.json({ error: "THORName doesn't exist" }, { status: 400 });
    const u = new URL(url);
    const refund = u.searchParams.get("refund_address");
    const aff = u.searchParams.get("affiliate");
    if (mode === "always-overflow" || (mode === "overflow" && refund))
      return new Response(TOO_LONG, { status: 400 });
    const dest = u.searchParams.get("destination")!;
    const destField =
      mode === "refund-in-memo" ? `${dest}/${BTC_TAKER}` : refund ? `${dest}/${refund}` : dest;
    return Response.json({
      inbound_address: "bc1qup236qj2mr87ml9388ydm33tuhtdckk33j68qx",
      memo: `=:e:${destField}:0/1/0${aff ? `:${aff}:${u.searchParams.get("affiliate_bps")}` : ""}`,
      expected_amount_out: "38000000",
      expiry: 2_000_000_000,
      fees: {
        asset: "ETH.ETH",
        affiliate: aff ? "1000" : "0",
        outbound: "0",
        liquidity: "0",
        total: "0",
      },
    });
  }) as unknown as typeof fetch;
  return {
    f,
    urls,
    swaps: () => urls.filter((x) => x.includes("/quote/swap")).map((x) => new URL(x)),
  };
};
const pricer: Pricer = {
  token: async (c) => ({ priceUsd: c === 1 ? 2000 : 60000, decimals: c === 1 ? 18 : 8 }),
  usd: async (c, _a, amt) => (c === 1 ? (Number(amt) / 1e18) * 2000 : (Number(amt) / 1e8) * 60000),
};
const env = { SWAPCHAN_FEE_BPS: "10" } as NodeJS.ProcessEnv;
const sig = () => AbortSignal.timeout(1000);
const req = {
  fromChainId: BITCOIN,
  fromToken: NON_EVM[BITCOIN]!.native,
  toChainId: 1,
  toToken: "0x0000000000000000000000000000000000000000",
  amount: "1000000",
  slippageBps: 100,
  taker: BTC_TAKER,
  recipient: ETH_DEST,
} as unknown as QuoteRequest;

describe("thorchain: BTC memo fits 80-byte OP_RETURN", () => {
  it("retries without refund_address when THORChain says the memo is too long; refund defaults to the sender", async () => {
    const m = mock("overflow");
    const q = await thorchain(pricer, env, m.f).quote(req, sig());
    const s = m.swaps();
    expect(s).toHaveLength(2);
    expect(s[0]!.searchParams.get("refund_address")).toBe(BTC_TAKER);
    expect(s[1]!.searchParams.has("refund_address")).toBe(false);
    expect(s[1]!.searchParams.get("destination")).toBe(ETH_DEST);
    expect(s[1]!.searchParams.get("to_asset")).toBe("ETH.ETH");
    expect(q.toAmount).toBe("380000000000000000");
  });
  it("keeps refund_address when the memo fits (single call)", async () => {
    const m = mock("fits");
    await thorchain(pricer, env, m.f).quote(req, sig());
    expect(m.swaps()).toHaveLength(1);
    expect(m.swaps()[0]!.searchParams.get("refund_address")).toBe(BTC_TAKER);
  });
  it("never drops the affiliate: if the memo still overflows, refuses clearly", async () => {
    const m = mock("always-overflow", true);
    await expect(thorchain(pricer, env, m.f).quote(req, sig())).rejects.toThrow(
      /80-byte OP_RETURN.*refusing rather than dropping SwapChan's fee/,
    );
    const s = m.swaps();
    expect(s).toHaveLength(2);
    for (const u of s) {
      expect(u.searchParams.get("affiliate")).toBe("swapchan");
      expect(u.searchParams.get("affiliate_bps")).toBe("10");
    }
  });
  it("refuses if THORChain's shortened memo still names a refund address", async () => {
    const m = mock("refund-in-memo");
    const m2 = mock("overflow");
    // first call overflows, second returns a memo with a refund field
    let n = 0;
    const f = (async (url: string, init: RequestInit) =>
      url.includes("/quote/swap") && n++ > 0
        ? m.f(url, init)
        : m2.f(url, init)) as unknown as typeof fetch;
    await expect(thorchain(pricer, env, f).quote(req, sig())).rejects.toThrow(/unexpected refund/);
  });
  it("does not retry for EVM origins (no 80-byte limit)", async () => {
    const m = mock("always-overflow");
    await expect(
      thorchain(pricer, env, m.f).quote(
        {
          ...req,
          fromChainId: 1,
          fromToken: "0x0000000000000000000000000000000000000000",
          toChainId: BITCOIN,
          toToken: NON_EVM[BITCOIN]!.native,
          taker: ETH_DEST,
          recipient: BTC_TAKER,
          amount: "100000000000000000",
        } as unknown as QuoteRequest,
        sig(),
      ),
    ).rejects.toThrow(/memo/);
    expect(m.swaps()).toHaveLength(1);
  });
  it("does not retry other THORChain errors", async () => {
    const m = mock("fits");
    const f = (async (url: string, init: RequestInit) =>
      url.includes("/quote/swap")
        ? new Response(JSON.stringify({ message: "not enough asset to pay for fees" }), {
            status: 400,
          })
        : m.f(url, init)) as unknown as typeof fetch;
    await expect(thorchain(pricer, env, f).quote(req, sig())).rejects.toThrow(/fees/);
  });
});

describe("guard: shortened BTC memo still pins recipient", () => {
  it("parses dest with and without a refund field; a different dest is visible to the guard", () => {
    const short = `=:e:${ETH_DEST}:0/1/0`;
    expect(short.length).toBeLessThanOrEqual(80);
    expect(`=:e:${ETH_DEST}/${BTC_TAKER}:0/1/0`.length).toBeGreaterThan(80);
    expect(parseThorMemo(short)?.dest).toBe(ETH_DEST);
    expect(parseThorMemo(`=:e:${ETH_DEST}/${BTC_TAKER}:5/1/0`)?.dest).toBe(ETH_DEST);
    expect(parseThorMemo("=:e:0x0000000000000000000000000000000000000001:0/1/0")?.dest).not.toBe(
      ETH_DEST,
    );
  });
});
