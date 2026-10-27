import { BITCOIN_CASH, DOGECOIN, LITECOIN, NON_EVM, type QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import type { Pricer } from "./pricing.js";
import { thorchain } from "./providers/thorchain.js";

// Mocked THORChain (no network). Fixtures measured read-only on 2026-10-27 against thornode (liquify gateway),
// no affiliate (the "swapchan" THORName has no THOR alias yet, so production sends none):
//   LTC->ETH  + refund (ltc1 or L...)  -> 400 "generated memo too long for source chain"
//   LTC->ETH  no refund                -> "=:e:0xeb0e...5c7b:2347793/1/0"      58 bytes
//   LTC->DOGE + L... refund            -> 400 memo too long
//   LTC->DOGE no refund                -> "=:d:D8Xh...amQF:70237259635/1/0"   54 bytes
//   DOGE->ETH + D... refund            -> 400 memo too long;  no refund -> 58 bytes
//   BCH->ETH  + CashAddr refund        -> 400 memo too long (a ~102-byte memo, under 220);  no refund -> 59 bytes
// With the affiliate the memo gains ":swapchan:10" (12 bytes): 70, 66, 70 and 71 bytes.
const MEASURED = {
  ltcEth: "=:e:0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b:2347793/1/0",
  ltcDoge: "=:d:D8XhvXbJYovhJN7X51qkrYACDX29vBamQF:70237259635/1/0",
  dogeEth: "=:e:0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b:3242394/1/0",
  bchEth: "=:e:0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b:11983553/1/0",
};
const ETH_TO = "0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b";
const DOGE_TO = "D8XhvXbJYovhJN7X51qkrYACDX29vBamQF";
const LTC_BECH = "ltc1qe2tczyk2rw7u47kzxxee5g7ufkncdmlc9854ex";
const LTC_P2PKH = "LMUQpY3qDP8JE2Wwa4BukGXK5cULwo7mqx";
const DOGE_FROM = "D8XhvXbJYovhJN7X51qkrYACDX29vBamQF";
const BCH_FROM = "qr086xmjrg0qvv4heuzwmagr9j8vl75lng5q0hkfz5";
const VAULT: Record<string, string> = {
  LTC: "ltc1q8c37s9sq89v55vuffajkfcd3xj9m67sq3r2zcjktw0h2a4vuqzws4u8fax",
  DOGE: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
  BCH: "qq07d3s9k4u8x7n5c9dzzd9prh5ryedhxqrxsjrpmg",
};
const TOO_LONG = JSON.stringify({
  code: 3,
  message: "generated memo too long for source chain: invalid request",
});

type Mode = "refund-overflows" | "always-overflow" | "refund-in-memo" | "fits";
const mock = (mode: Mode, thorname = false) => {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    if (url.endsWith("/pools")) return Response.json([]);
    if (url.includes("/thorname/"))
      return thorname
        ? Response.json({ aliases: [{ chain: "THOR" }] })
        : Response.json({ error: "THORName doesn't exist" }, { status: 400 });
    if (url.endsWith("/inbound_addresses"))
      return Response.json(
        Object.entries(VAULT).map(([chain, address]) => ({
          chain,
          address,
          halted: false,
          dust_threshold: chain === "DOGE" ? "100000000" : "10000",
        })),
      );
    const u = new URL(url);
    const from = u.searchParams.get("from_asset")!.split(".")[0]!;
    const refund = u.searchParams.get("refund_address");
    const aff = u.searchParams.get("affiliate");
    if (mode === "always-overflow" || (mode === "refund-overflows" && refund))
      return new Response(TOO_LONG, { status: 400 });
    const dest = u.searchParams.get("destination")!;
    const to = u.searchParams.get("to_asset") === "DOGE.DOGE" ? "d" : "e";
    const destField =
      mode === "refund-in-memo" ? `${dest}/${LTC_P2PKH}` : refund ? `${dest}/${refund}` : dest;
    const lim = to === "d" ? "70237259635/1/0" : "2347793/1/0";
    return Response.json({
      inbound_address: VAULT[from],
      memo: `=:${to}:${destField}:${refund ? "1" : lim}${aff ? `:${aff}:${u.searchParams.get("affiliate_bps")}` : ""}`,
      expected_amount_out: "38000000",
      expiry: 2_000_000_000,
      dust_threshold: "10000",
      fees: { asset: "ETH.ETH", affiliate: "0", outbound: "0", liquidity: "0", total: "0" },
    });
  }) as unknown as typeof fetch;
  return {
    f,
    swaps: () => urls.filter((x) => x.includes("/quote/swap")).map((x) => new URL(x)),
  };
};
const pricer: Pricer = {
  token: async (c) => ({ priceUsd: 100, decimals: c === 1 ? 18 : 8 }),
  usd: async () => 1,
};
const env = { SWAPCHAN_FEE_BPS: "10" } as NodeJS.ProcessEnv;
const sig = () => AbortSignal.timeout(2000);
const ONE = 100_000_000n;
const reqOf = (from: number, to: number, recipient: string, amount = ONE): QuoteRequest =>
  ({
    fromChainId: from,
    fromToken: NON_EVM[from]!.native,
    toChainId: to,
    toToken: to === 1 ? "0x0000000000000000000000000000000000000000" : NON_EVM[to]!.native,
    amount: amount.toString(),
    slippageBps: 100,
    recipient,
  }) as QuoteRequest;
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("measured THORChain memo fixtures (LTC/DOGE/BCH, no refund)", () => {
  it("byte counts as measured live", () => {
    expect(bytes(MEASURED.ltcEth)).toBe(58);
    expect(bytes(MEASURED.ltcDoge)).toBe(54);
    expect(bytes(MEASURED.dogeEth)).toBe(58);
    expect(bytes(MEASURED.bchEth)).toBe(59);
    // with the affiliate (":swapchan:10") every one still fits 80 bytes
    for (const m of Object.values(MEASURED))
      expect(bytes(`${m}:swapchan:10`)).toBeLessThanOrEqual(80);
  });
});

describe("deposit flow: memo too long with a refund address -> retry without it", () => {
  const cases: [string, QuoteRequest, string][] = [
    ["LTC->ETH, ltc1 refund", reqOf(LITECOIN, 1, ETH_TO), LTC_BECH],
    ["LTC->ETH, legacy L refund", reqOf(LITECOIN, 1, ETH_TO), LTC_P2PKH],
    ["LTC->DOGE, legacy L refund", reqOf(LITECOIN, DOGECOIN, DOGE_TO), LTC_P2PKH],
    ["DOGE->ETH, D refund", reqOf(DOGECOIN, 1, ETH_TO, 10n * ONE), DOGE_FROM],
    ["BCH->ETH, CashAddr refund", reqOf(BITCOIN_CASH, 1, ETH_TO), `bitcoincash:${BCH_FROM}`],
  ];
  for (const [name, req, refund] of cases)
    it(`${name}: refunds go to the sender, said plainly`, async () => {
      const m = mock("refund-overflows");
      const d = await thorchain(pricer, env, m.f).deposit(req, refund, sig());
      const s = m.swaps();
      expect(s).toHaveLength(2);
      expect(s[0]!.searchParams.has("refund_address")).toBe(true);
      expect(s[1]!.searchParams.has("refund_address")).toBe(false);
      expect(d.refundInMemo).toBe(false);
      expect(d.refundTo).toBe("sender");
      expect(d.memo).not.toContain("/" + refund.replace(/^bitcoincash:/, ""));
      expect((d.memo.split(":")[2] ?? "").includes("/")).toBe(false);
      expect(d.memoBytes).toBe(bytes(d.memo));
      expect(d.memoBytes).toBeLessThanOrEqual(d.memoLimit);
      expect(BigInt(d.amount)).toBe(BigInt(req.amount));
      expect(d.warnings[0]).toMatch(/REFUNDS GO BACK TO THE ADDRESS THAT SENT THE COINS/);
      expect(d.warnings.join(" ")).toMatch(
        /Never send from an exchange or from any address you do not control/,
      );
      expect(d.warnings.join(" ")).not.toMatch(/refund would go to the address in the memo/);
    });
  it("no refund address given: one call, none in the memo, same warning", async () => {
    const m = mock("refund-overflows");
    const d = await thorchain(pricer, env, m.f).deposit(
      reqOf(LITECOIN, 1, ETH_TO),
      undefined,
      sig(),
    );
    expect(m.swaps()).toHaveLength(1);
    expect(m.swaps()[0]!.searchParams.has("refund_address")).toBe(false);
    expect(d).toMatchObject({
      refund: "",
      refundInMemo: false,
      refundTo: "sender",
      memo: MEASURED.ltcEth,
      memoBytes: 58,
    });
  });
  it("refund fits: kept in the memo, refundInMemo true", async () => {
    const m = mock("fits");
    const d = await thorchain(pricer, env, m.f).deposit(
      reqOf(LITECOIN, DOGECOIN, DOGE_TO),
      LTC_P2PKH,
      sig(),
    );
    expect(m.swaps()).toHaveLength(1);
    expect(d).toMatchObject({ refund: LTC_P2PKH, refundInMemo: true, refundTo: "memo" });
    expect(d.warnings.join(" ")).not.toMatch(/REFUNDS GO BACK/);
  });
  it("never drops the affiliate; still too long without the refund -> refused clearly", async () => {
    const m = mock("always-overflow", true);
    await expect(
      thorchain(pricer, env, m.f).deposit(reqOf(LITECOIN, 1, ETH_TO), LTC_P2PKH, sig()),
    ).rejects.toThrow(
      /80-byte OP_RETURN even without a refund address; refusing rather than dropping SwapChan's fee/,
    );
    const s = m.swaps();
    expect(s).toHaveLength(2);
    for (const u of s) {
      expect(u.searchParams.get("affiliate")).toBe("swapchan");
      expect(u.searchParams.get("affiliate_bps")).toBe("10");
    }
  });
  it("BCH refusal names THORChain's limit, not 220 bytes", async () => {
    const m = mock("always-overflow");
    await expect(
      thorchain(pricer, env, m.f).deposit(reqOf(BITCOIN_CASH, 1, ETH_TO), BCH_FROM, sig()),
    ).rejects.toThrow(/BCH's THORChain's memo limit even without a refund address/);
  });
  it("affiliate kept on the retry and in the returned memo", async () => {
    const m = mock("refund-overflows", true);
    const d = await thorchain(pricer, env, m.f).deposit(
      reqOf(LITECOIN, 1, ETH_TO),
      LTC_P2PKH,
      sig(),
    );
    expect(d.memo.endsWith(":swapchan:10")).toBe(true);
    expect(d.memoBytes).toBe(70);
  });
  it("refuses if THORChain's retried memo still names a refund address", async () => {
    const over = mock("refund-overflows");
    const bad = mock("refund-in-memo");
    let n = 0;
    const f = (async (url: string, init: RequestInit) =>
      url.includes("/quote/swap") && n++ > 0
        ? bad.f(url, init)
        : over.f(url, init)) as unknown as typeof fetch;
    await expect(
      thorchain(pricer, env, f).deposit(reqOf(LITECOIN, 1, ETH_TO), LTC_P2PKH, sig()),
    ).rejects.toThrow(/unexpected refund/);
  });
  it("still refuses a refund address for the wrong chain", async () => {
    await expect(
      thorchain(pricer, env, mock("fits").f).deposit(reqOf(LITECOIN, 1, ETH_TO), DOGE_FROM, sig()),
    ).rejects.toThrow(/refund address/);
  });
});

describe("PSBT path (quote with taker): same retry", () => {
  it("LTC taker: memo too long with refund -> retried without, affiliate kept", async () => {
    const m = mock("refund-overflows", true);
    const q = await thorchain(pricer, env, m.f).quote(
      { ...reqOf(LITECOIN, 1, ETH_TO), taker: LTC_BECH },
      sig(),
    );
    const s = m.swaps();
    expect(s).toHaveLength(2);
    expect(s[0]!.searchParams.get("refund_address")).toBe(LTC_BECH);
    expect(s[1]!.searchParams.has("refund_address")).toBe(false);
    for (const u of s) expect(u.searchParams.get("affiliate")).toBe("swapchan");
    expect(BigInt(q.toAmount)).toBe(380_000_000_000_000_000n);
  });
});

describe("deposit: THORChain's memo must pay the requested recipient and asset", () => {
  const withMemo = (memo: string, mode: Mode = "fits") => {
    const m = mock(mode);
    return (async (url: string, init: RequestInit) => {
      const r = await m.f(url, init);
      if (!url.includes("/quote/swap") || r.status !== 200) return r;
      return Response.json({ ...(await r.json()), memo });
    }) as unknown as typeof fetch;
  };
  const ltcEth = reqOf(LITECOIN, 1, ETH_TO);
  it("refuses a memo paying another recipient (review repro)", async () => {
    await expect(
      thorchain(
        pricer,
        env,
        withMemo("=:e:0x000000000000000000000000000000000000dEaD:1/1/0"),
      ).deposit(ltcEth, undefined, sig()),
    ).rejects.toThrow(/memo destination .* != 0xeb0e/);
  });
  it("refuses the wrong recipient on the retry-without-refund memo too", async () => {
    await expect(
      thorchain(
        pricer,
        env,
        withMemo("=:e:0x000000000000000000000000000000000000dEaD:1/1/0", "refund-overflows"),
      ).deposit(ltcEth, LTC_P2PKH, sig()),
    ).rejects.toThrow(/memo destination/);
  });
  it("refuses a memo naming the wrong asset", async () => {
    await expect(
      thorchain(pricer, env, withMemo(`=:b:${ETH_TO}:1/1/0`)).deposit(ltcEth, undefined, sig()),
    ).rejects.toThrow(/memo asset b is not ETH.ETH/);
    await expect(
      thorchain(pricer, env, withMemo(`=:BTC.BTC:${ETH_TO}:1/1/0`)).deposit(
        ltcEth,
        undefined,
        sig(),
      ),
    ).rejects.toThrow(/memo asset BTC.BTC/);
    await expect(
      thorchain(pricer, env, withMemo(`=:e:${DOGE_TO}:1/1/0`)).deposit(
        reqOf(LITECOIN, DOGECOIN, DOGE_TO),
        undefined,
        sig(),
      ),
    ).rejects.toThrow(/memo asset e is not DOGE.DOGE/);
  });
  it("refuses an unparseable memo", async () => {
    for (const bad of ["garbage", "", "=:e"])
      await expect(
        thorchain(pricer, env, withMemo(bad)).deposit(ltcEth, undefined, sig()),
      ).rejects.toThrow(/unparseable THORChain memo/);
  });
  it("accepts an EVM recipient differing only in case, and the full asset name", async () => {
    const d = await thorchain(
      pricer,
      env,
      withMemo(`=:ETH.ETH:${ETH_TO.toUpperCase().replace("0X", "0x")}:1/1/0`),
    ).deposit(ltcEth, undefined, sig());
    expect(d.refundInMemo).toBe(false);
  });
  it("refuses a UTXO recipient that differs only in case", async () => {
    const flipped = DOGE_TO.replace("D8Xh", "D8XH");
    await expect(
      thorchain(pricer, env, withMemo(`=:d:${flipped}:1/1/0`)).deposit(
        reqOf(LITECOIN, DOGECOIN, DOGE_TO),
        undefined,
        sig(),
      ),
    ).rejects.toThrow(/memo destination/);
    const ok = await thorchain(pricer, env, withMemo(`=:DOGE.DOGE:${DOGE_TO}:1/1/0`)).deposit(
      reqOf(LITECOIN, DOGECOIN, DOGE_TO),
      undefined,
      sig(),
    );
    expect(ok.memo).toBe(`=:DOGE.DOGE:${DOGE_TO}:1/1/0`);
  });
  it("refuses a deposit with no recipient", async () => {
    const { recipient: _r, ...noRecipient } = ltcEth;
    await expect(
      thorchain(pricer, env, mock("fits").f).deposit(noRecipient as QuoteRequest, undefined, sig()),
    ).rejects.toThrow(/recipient required/);
  });
});
