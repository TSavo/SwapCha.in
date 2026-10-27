import { BITCOIN, LITECOIN, NON_EVM, type QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { buildBtcPsbt } from "./btc.js";
import { thorMemoMismatch } from "./guard/index.js";
import type { Pricer } from "./pricing.js";
import { thorchain } from "./providers/thorchain.js";
import { RouteRefused } from "./utxodest.js";

// Live read-only replies (liquify thornode gateway, streaming 1/0, affiliate swapchan:10), 2026-10-27 ~16:30 PDT:
//   0.5 LTC->BTC tolerance_bps=100 -> "emit asset 34166 less than price limit 34970"; tolerance_bps=300 -> limit 34264
//   0.5 LTC->BTC liquidity_tolerance_bps=50/100/300 -> memo limits 33960/33789/33107, expected_amount_out 34131
//   1 LTC->USDC liquidity_tolerance_bps=100 -> "=:ETH.USDC:0xeb0e...:5604082242/1/0:swapchan:10" (out 5660689134)
//   1 LTC->USDT -> "=:ETH.USDT:0xeb0e...:5610201616/1/0:swapchan:10" (out 5666870320)
//   Available pools: exactly one per chain+symbol (ETH.USDC-0XA0B8..., ETH.USDT-0XDAC1..., BSC.USDC-0X8AC7..., ...)
const ETH_TO = "0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b";
const BTC_TO = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const USDC = "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48";
const USDT = "ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7";
const BSC_USDC = "BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D";
const POOLS = [USDC, USDT, BSC_USDC, "ETH.ETH", "BTC.BTC", "LTC.LTC"];
const MEMO_USDC = `=:ETH.USDC:${ETH_TO}:5604082242/1/0:swapchan:10`;
const MEMO_USDT = `=:ETH.USDT:${ETH_TO}:5610201616/1/0:swapchan:10`;

describe("guard: bare THORChain token form (ETH.USDC) only for the requested token", () => {
  it("accepts the measured LTC->USDC and LTC->USDT memos when the pool is unique", () => {
    expect(thorMemoMismatch(MEMO_USDC, 1, USDC, ETH_TO, POOLS)).toBeNull();
    expect(thorMemoMismatch(MEMO_USDT, 1, USDT, ETH_TO, POOLS)).toBeNull();
  });
  it("refuses the bare form without a pool list", () => {
    expect(thorMemoMismatch(MEMO_USDC, 1, USDC, ETH_TO)).toMatch(/memo asset ETH.USDC/);
  });
  it("refuses USDT when USDC was requested and vice versa", () => {
    expect(thorMemoMismatch(MEMO_USDT, 1, USDC, ETH_TO, POOLS)).toMatch(/memo asset/);
    expect(thorMemoMismatch(MEMO_USDC, 1, USDT, ETH_TO, POOLS)).toMatch(/memo asset/);
  });
  it("still refuses USDT carrying a USDC contract suffix", () => {
    const m = `=:ETH.USDT-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48:${ETH_TO}:1/1/0:swapchan:10`;
    expect(thorMemoMismatch(m, 1, USDC, ETH_TO, POOLS)).toMatch(/memo asset/);
  });
  it("refuses BSC USDC for ETH USDC, bare or full", () => {
    expect(thorMemoMismatch(`=:BSC.USDC:${ETH_TO}:1/1/0`, 1, USDC, ETH_TO, POOLS)).toMatch(
      /memo asset/,
    );
    expect(thorMemoMismatch(`=:${BSC_USDC}:${ETH_TO}:1/1/0`, 1, USDC, ETH_TO, POOLS)).toMatch(
      /memo asset/,
    );
  });
  it("refuses the bare form when two Available pools share the symbol", () => {
    const dup = [...POOLS, "ETH.USDC-0X0000000000000000000000000000000000000001"];
    expect(thorMemoMismatch(MEMO_USDC, 1, USDC, ETH_TO, dup)).toMatch(/memo asset/);
  });
  it("refuses the bare form when the only pool is another contract", () => {
    const other = ["ETH.USDC-0X0000000000000000000000000000000000000001"];
    expect(thorMemoMismatch(MEMO_USDC, 1, USDC, ETH_TO, other)).toMatch(/memo asset/);
  });
});

const pricer: Pricer = {
  token: async (c) => ({ priceUsd: 1, decimals: c === 1 ? 6 : 8 }),
  usd: async () => 1,
};
const env = { SWAPCHAN_FEE_BPS: "10" } as NodeJS.ProcessEnv;
const mock = (memo: string, out: string) => {
  const urls: URL[] = [];
  const f = (async (url: string) => {
    if (url.endsWith("/pools"))
      return Response.json(POOLS.map((asset) => ({ asset, status: "Available" })));
    if (url.includes("/thorname/")) return Response.json({ aliases: [{ chain: "THOR" }] });
    if (url.endsWith("/inbound_addresses"))
      return Response.json([
        {
          chain: "LTC",
          address: "ltc1q8c37s9sq89v55vuffajkfcd3xj9m67sq3r2zcjktw0h2a4vuqzws4u8fax",
          halted: false,
          dust_threshold: "10000",
        },
      ]);
    urls.push(new URL(url));
    return Response.json({
      inbound_address: "ltc1q8c37s9sq89v55vuffajkfcd3xj9m67sq3r2zcjktw0h2a4vuqzws4u8fax",
      memo,
      expected_amount_out: out,
      expiry: 2_000_000_000,
      dust_threshold: "10000",
      fees: { asset: "ETH.ETH", affiliate: "0", outbound: "0", liquidity: "0", total: "0" },
    });
  }) as unknown as typeof fetch;
  return { f, urls };
};
const req = (toChainId: number, toToken: string, recipient: string, slippageBps = 100) =>
  ({
    fromChainId: LITECOIN,
    fromToken: NON_EVM[LITECOIN]!.native,
    toChainId,
    toToken,
    amount: "100000000",
    slippageBps,
    recipient,
  }) as QuoteRequest;

describe("THORChain quotes use liquidity_tolerance_bps", () => {
  it("LTC->USDC deposit: bare memo accepted, liquidity tolerance sent, no tolerance_bps", async () => {
    const m = mock(MEMO_USDC, "5660689134");
    const d = await thorchain(pricer, env, m.f).deposit(
      req(1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", ETH_TO),
      undefined,
      AbortSignal.timeout(2000),
    );
    expect(JSON.stringify(d)).toContain("ETH.USDC");
    const u = m.urls.at(-1)!;
    expect(u.searchParams.get("liquidity_tolerance_bps")).toBe("100");
    expect(u.searchParams.has("tolerance_bps")).toBe(false);
  });
  it("floors at 100 bps (never 0 = no limit) and honours larger slippage", async () => {
    const memo = `=:b:${BTC_TO}:33789/1/0:swapchan:10`;
    for (const [s, want] of [
      [1, "100"],
      [300, "300"],
    ] as const) {
      const m = mock(memo, "34131");
      await thorchain(pricer, env, m.f)
        .deposit(
          req(BITCOIN, NON_EVM[BITCOIN]!.native, BTC_TO, s),
          undefined,
          AbortSignal.timeout(2000),
        )
        .catch(() => null);
      expect(m.urls.at(-1)!.searchParams.get("liquidity_tolerance_bps")).toBe(want);
    }
  });
});

describe("BTC PSBT with no coins", () => {
  it("is a RouteRefused (400) 'no BTC found at this address'", async () => {
    const p = buildBtcPsbt(async () => [], {
      from: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      to: BTC_TO,
      amount: 10_000n,
      feeRate: 2,
    });
    await expect(p).rejects.toBeInstanceOf(RouteRefused);
    await expect(p).rejects.toThrow("no BTC found at this address");
  });
});
