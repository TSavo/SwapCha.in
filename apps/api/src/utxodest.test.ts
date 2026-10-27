import {
  BITCOIN_CASH,
  Chain,
  DOGECOIN,
  isReceiveOnly,
  isVmAddress,
  LITECOIN,
  NON_EVM,
  type QuoteRequest,
  RECEIVE_ONLY_CHAINS,
  SUPPORTED_CHAINS,
  tokenList,
  vmOf,
} from "@swapchan/shared";
import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import type { GuardCtx } from "./guard/ctx.js";
import { type Payload, verifyPayload } from "./guard/index.js";
import { createApp } from "./index.js";
import type { Pricer } from "./pricing.js";
import { thorchain } from "./providers/thorchain.js";
import { gateUtxoRoute, RouteRefused, validateUtxoRecipient } from "./utxodest.js";

// Vectors: random hashes encoded per chain; every positive one is accepted by blocktools' addressValidate.
const LTC = {
  wpkh: "ltc1qe2tczyk2rw7u47kzxxee5g7ufkncdmlc9854ex",
  wsh: "ltc1q8c37s9sq89v55vuffajkfcd3xj9m67sq3r2zcjktw0h2a4vuqzws4u8fax",
  p2pkh: "LMUQpY3qDP8JE2Wwa4BukGXK5cULwo7mqx",
  p2sh: "MDgnddLwm4A3Uh6M1zpAx7e1W6ktE4bnE4",
  taproot: "ltc1p9e7jcqaf2pawye0v7k6n26y955ee8gszn5jp89yewfj6rgj6alrqmg76aq",
  legacy3: "37UeKjvyowJcgBpSv7pq8UPcBQASC9Hmtt",
  testBech: "tltc1qe2tczyk2rw7u47kzxxee5g7ufkncdmlcj4hu2v",
  testP2pkh: "mhmQrNpywkKVkLJQ7VAzJAfsjPhmfWfvpc",
};
const BTC = ["bc1qe2tczyk2rw7u47kzxxee5g7ufkncdmlcpmw3pk", "13FTZKk18itEyDpnPvCcUFTYsQ74kNqr9z"];
const DOGE = {
  p2pkh: "D8XhvXbJYovhJN7X51qkrYACDX29vBamQF",
  p2sh: "AB8RxY6p1paC4gL1ivYzfeXgsyXkoWms9e",
  test: "nXameYLDUnPRBLgi6qVD6wkVTPQSx5nr3x",
  test2: "2NBwPHRxwZDCeN6b5yvWT3TtaPkMtWKv1gf",
};
const BCH = {
  p2pkh: "bitcoincash:qr086xmjrg0qvv4heuzwmagr9j8vl75lng5q0hkfz5",
  p2sh: "bitcoincash:pqvf7sqrf0n6rx03l2vfze5wuw4kqj0c95352cmr27",
  test: "bchtest:qr086xmjrg0qvv4heuzwmagr9j8vl75lngsjts579g",
  legacy: "1MHQtBtN3uH4AUUcLfPX9daMV479JCQnJZ",
};
const ok = (c: number, a: string) => validateUtxoRecipient(c, a);
const flip = (a: string) => a.slice(0, -1) + (a.endsWith("q") ? "p" : "q");

describe("receive-only UTXO chains: shared registry", () => {
  it("lists LTC, DOGE, BCH as uvm, receive-only, 8-decimal native coins", () => {
    expect(RECEIVE_ONLY_CHAINS).toEqual([LITECOIN, DOGECOIN, BITCOIN_CASH]);
    for (const id of RECEIVE_ONLY_CHAINS) {
      expect(id in SUPPORTED_CHAINS).toBe(true);
      expect(vmOf(id)).toBe("uvm");
      expect(isReceiveOnly(id)).toBe(true);
      const t = tokenList.filter((x) => x.chainId === id);
      expect(t).toHaveLength(1);
      expect(t[0]).toMatchObject({ address: NON_EVM[id]!.native, decimals: 8 });
      expect(ok(id, NON_EVM[id]!.native).ok).toBe(false); // sentinel is never a payout
    }
    for (const id of [1, 8253038, 792703809, 728126428]) expect(isReceiveOnly(id)).toBe(false);
    expect(
      Chain.parse({ id: LITECOIN, name: "Litecoin", mascot: "x", receiveOnly: true }),
    ).toBeTruthy();
    expect(isVmAddress(LTC.wpkh, "uvm")).toBe(true);
    expect(isVmAddress(DOGE.p2pkh, "uvm")).toBe(true);
    expect(isVmAddress(BCH.p2pkh, "uvm")).toBe(true);
  });
});

describe("validateUtxoRecipient (blocktools only)", () => {
  it("Litecoin: P2PKH, P2SH, SegWit v0 accepted; taproot, 3..., testnet, BTC, bad checksum refused", () => {
    for (const a of [LTC.wpkh, LTC.wsh, LTC.p2pkh, LTC.p2sh])
      expect(ok(LITECOIN, a)).toMatchObject({ ok: true, address: a });
    expect(ok(LITECOIN, LTC.wpkh.toUpperCase())).toMatchObject({ ok: true, address: LTC.wpkh });
    for (const a of [
      LTC.taproot,
      LTC.legacy3,
      LTC.testBech,
      LTC.testP2pkh,
      ...BTC,
      DOGE.p2pkh,
      BCH.p2pkh,
      flip(LTC.wpkh),
      "",
    ])
      expect(ok(LITECOIN, a).ok, a).toBe(false);
  });
  it("Dogecoin: D... and A... accepted; testnet, BTC, LTC, bad checksum refused", () => {
    for (const a of [DOGE.p2pkh, DOGE.p2sh])
      expect(ok(DOGECOIN, a)).toMatchObject({ ok: true, address: a });
    for (const a of [
      DOGE.test,
      DOGE.test2,
      ...BTC,
      LTC.p2pkh,
      LTC.wpkh,
      BCH.p2pkh,
      flip(DOGE.p2pkh),
    ])
      expect(ok(DOGECOIN, a).ok, a).toBe(false);
  });
  it("Bitcoin Cash: CashAddr (prefix optional) accepted and made prefixless; legacy, testnet, BTC refused", () => {
    expect(ok(BITCOIN_CASH, BCH.p2pkh)).toMatchObject({ ok: true, address: BCH.p2pkh.slice(12) });
    expect(ok(BITCOIN_CASH, BCH.p2sh)).toMatchObject({ ok: true, address: BCH.p2sh.slice(12) });
    expect(ok(BITCOIN_CASH, BCH.p2pkh.slice(12))).toMatchObject({
      ok: true,
      address: BCH.p2pkh.slice(12),
    });
    expect(ok(BITCOIN_CASH, BCH.p2pkh.toUpperCase())).toMatchObject({
      ok: true,
      address: BCH.p2pkh.slice(12),
    });
    for (const a of [BCH.test, BCH.legacy, ...BTC, LTC.wpkh, DOGE.p2pkh, flip(BCH.p2pkh)])
      expect(ok(BITCOIN_CASH, a).ok, a).toBe(false);
  });
  it("is not a UTXO chain check for other chains", () => {
    expect(ok(1, LTC.wpkh).ok).toBe(false);
  });
});

const base = {
  fromChainId: 1,
  fromToken: "0x0000000000000000000000000000000000000000",
  amount: "100000000000000000",
  slippageBps: 100,
};
describe("gateUtxoRoute", () => {
  it("allows LTC/DOGE/BCH as origin (THORChain only) with clear refusals", () => {
    for (const id of RECEIVE_ONLY_CHAINS) {
      const from = { ...base, fromChainId: id, fromToken: NON_EVM[id]!.native };
      expect(gateUtxoRoute({ ...from, toChainId: 1, toToken: base.fromToken })).toMatchObject({
        fromChainId: id,
      });
      expect(() => gateUtxoRoute({ ...from, toChainId: id, toToken: NON_EVM[id]!.native })).toThrow(
        /not a swap/,
      );
      expect(() =>
        gateUtxoRoute({ ...from, fromToken: "0xdead", toChainId: 1, toToken: base.fromToken }),
      ).toThrow(/only the native coin/);
    }
  });
  it("requires the native coin and a valid recipient for the destination; canonicalizes BCH", () => {
    const r = gateUtxoRoute({
      ...base,
      toChainId: BITCOIN_CASH,
      toToken: NON_EVM[BITCOIN_CASH]!.native,
      recipient: BCH.p2pkh,
    });
    expect(r.recipient).toBe(BCH.p2pkh.slice(12));
    expect(() =>
      gateUtxoRoute({ ...base, toChainId: LITECOIN, toToken: "0xdead", recipient: LTC.wpkh }),
    ).toThrow(RouteRefused);
    expect(() =>
      gateUtxoRoute({
        ...base,
        toChainId: LITECOIN,
        toToken: NON_EVM[LITECOIN]!.native,
        recipient: BTC[0],
      }),
    ).toThrow(/recipient/);
    expect(gateUtxoRoute({ ...base, toChainId: 1, toToken: base.fromToken })).toMatchObject({
      toChainId: 1,
    });
  });
});

// Mocked THORChain (no network).
const ROUTER = "0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146";
const VAULT = "0x1111111111111111111111111111111111111111";
const TAKER = "0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b";
const CODE: Record<number, string> = { [LITECOIN]: "l", [DOGECOIN]: "d", [BITCOIN_CASH]: "c" };
const thorMock = () => {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    if (url.endsWith("/pools")) return Response.json([]);
    if (url.includes("/thorname/"))
      return Response.json({ error: "THORName doesn't exist" }, { status: 400 });
    const u = new URL(url);
    const to = u.searchParams.get("to_asset")!;
    const id = { "LTC.LTC": LITECOIN, "DOGE.DOGE": DOGECOIN, "BCH.BCH": BITCOIN_CASH }[to]!;
    return Response.json({
      inbound_address: VAULT,
      router: ROUTER,
      memo: `=:${CODE[id]}:${u.searchParams.get("destination")}:123/1/0`,
      expected_amount_out: "123456789",
      expiry: 2_000_000_000,
      fees: { asset: to, affiliate: "0", outbound: "0", liquidity: "0", total: "0" },
    });
  }) as unknown as typeof fetch;
  return { f, urls };
};
const pricer: Pricer = {
  token: async (c) => ({ priceUsd: c === 1 ? 2000 : 100, decimals: c === 1 ? 18 : 8 }),
  usd: async (c, _a, amt) => (c === 1 ? (Number(amt) / 1e18) * 2000 : (Number(amt) / 1e8) * 100),
};
const env = { SWAPCHAN_FEE_BPS: "10" } as NodeJS.ProcessEnv;
const sig = () => AbortSignal.timeout(1000);
const guardCtx: GuardCtx = {
  thorInbound: async () => [{ chain: "ETH", address: VAULT, router: ROUTER }],
  relay: async () => ({ contracts: [], solvers: [] }),
  zeroxSettlers: async () => [],
};

describe("thorchain: EVM -> LTC/DOGE/BCH", () => {
  const dests = [
    [LITECOIN, LTC.wpkh, LTC.wpkh, "LTC.LTC"],
    [DOGECOIN, DOGE.p2pkh, DOGE.p2pkh, "DOGE.DOGE"],
    [BITCOIN_CASH, BCH.p2pkh, BCH.p2pkh.slice(12), "BCH.BCH"],
  ] as const;
  it("quotes each coin with 8-decimal amounts and the validated address in the memo; guard verifies", async () => {
    for (const [id, input, canon, asset] of dests) {
      const m = thorMock();
      const p = thorchain(pricer, env, m.f);
      const req = {
        ...base,
        toChainId: id,
        toToken: NON_EVM[id]!.native,
        taker: TAKER,
        recipient: input,
      } as QuoteRequest;
      expect(p.supports(req)).toBe(true);
      const q = await p.quote(req, sig());
      const u = new URL(m.urls.find((x) => x.includes("/quote/swap"))!);
      expect(u.searchParams.get("to_asset")).toBe(asset);
      expect(u.searchParams.get("destination")).toBe(canon);
      expect(u.searchParams.get("amount")).toBe("10000000"); // 0.1 ETH in 1e8 units
      expect(u.searchParams.has("affiliate")).toBe(false); // no THORName: unchanged fee handling
      expect(q.toAmount).toBe("123456789");
      expect(q.ourFeeVerified).toBe(false);
      const v = await verifyPayload(
        {
          provider: "thorchain",
          req: { ...req, recipient: canon },
          toAmount: q.toAmount,
          tx: q.tx,
        } as unknown as Payload,
        guardCtx,
      );
      expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    }
  });
  it("supports LTC/DOGE/BCH as origin, and refuses a bad recipient before calling THORChain", async () => {
    const m = thorMock();
    const p = thorchain(pricer, env, m.f);
    for (const id of RECEIVE_ONLY_CHAINS)
      expect(
        p.supports({
          ...base,
          fromChainId: id,
          fromToken: NON_EVM[id]!.native,
          toChainId: 1,
          toToken: base.fromToken,
        } as QuoteRequest),
      ).toBe(true);
    await expect(
      p.quote(
        {
          ...base,
          toChainId: LITECOIN,
          toToken: NON_EVM[LITECOIN]!.native,
          recipient: BTC[0],
        } as QuoteRequest,
        sig(),
      ),
    ).rejects.toThrow(/recipient/);
    expect(m.urls.some((x) => x.includes("/quote/swap"))).toBe(false);
  });
  it("indicative quote without a recipient uses the unspendable sentinel", async () => {
    const m = thorMock();
    await thorchain(pricer, env, m.f).quote(
      { ...base, toChainId: DOGECOIN, toToken: NON_EVM[DOGECOIN]!.native } as QuoteRequest,
      sig(),
    );
    expect(
      new URL(m.urls.find((x) => x.includes("/quote/swap"))!).searchParams.get("destination"),
    ).toBe(NON_EVM[DOGECOIN]!.native);
  });
});

describe("guard: THORChain memo to a UTXO chain", () => {
  const thorTx = (toChainId: number, recipient: string, memo: string) =>
    ({
      provider: "thorchain",
      req: { ...base, toChainId, toToken: NON_EVM[toChainId]!.native, taker: TAKER, recipient },
      toAmount: "1",
      tx: {
        chainId: 1,
        to: ROUTER,
        value: base.amount,
        data: encodeFunctionData({
          abi: parseAbi([
            "function depositWithExpiry(address vault,address asset,uint256 amount,string memo,uint256 expiration)",
          ]),
          functionName: "depositWithExpiry",
          args: [
            VAULT,
            "0x0000000000000000000000000000000000000000",
            BigInt(base.amount),
            memo,
            9999999999n,
          ],
        }),
      },
    }) as unknown as Payload;
  const failed = async (p: Payload) =>
    (await verifyPayload(p, guardCtx)).checks.filter((c) => !c.ok).map((c) => c.name);
  it("accepts exact memo match (short and full asset codes)", async () => {
    expect(await failed(thorTx(LITECOIN, LTC.wpkh, `=:l:${LTC.wpkh}:1`))).toEqual([]);
    expect(await failed(thorTx(DOGECOIN, DOGE.p2pkh, `=:DOGE.DOGE:${DOGE.p2pkh}:1`))).toEqual([]);
    expect(await failed(thorTx(BITCOIN_CASH, BCH.p2pkh, `=:c:${BCH.p2pkh.slice(12)}:1`))).toEqual(
      [],
    );
  });
  it("rejects another address, wrong case, wrong coin, invalid recipient", async () => {
    expect(await failed(thorTx(LITECOIN, LTC.wpkh, `=:l:${LTC.wsh}:1`))).toContain("recipient");
    expect(await failed(thorTx(LITECOIN, LTC.wpkh, `=:l:${LTC.wpkh.toUpperCase()}:1`))).toContain(
      "recipient",
    );
    expect(await failed(thorTx(LITECOIN, LTC.wpkh, `=:b:${LTC.wpkh}:1`))).toContain("outToken");
    expect(await failed(thorTx(DOGECOIN, DOGE.p2pkh, `=:l:${DOGE.p2pkh}:1`))).toContain("outToken");
    expect(await failed(thorTx(LITECOIN, BTC[0]!, `=:l:${BTC[0]}:1`))).toContain("recipient");
    expect(await failed(thorTx(BITCOIN_CASH, BCH.legacy, `=:c:${BCH.legacy}:1`))).toContain(
      "recipient",
    );
    expect(await failed(thorTx(DOGECOIN, DOGE.test, `=:d:${DOGE.test}:1`))).toContain("recipient");
  });
});

describe("API: /chains, /tokens, /quotes, /build", () => {
  const m = thorMock();
  const app = createApp([thorchain(pricer, env, m.f)], {
    pricer: null,
    guard: guardCtx,
    simulator: null,
  });
  it("/chains marks the three as receive-only uvm chains", async () => {
    const cs = (await (await app.request("/chains")).json()) as {
      id: number;
      vm: string;
      receiveOnly?: boolean;
    }[];
    for (const id of RECEIVE_ONLY_CHAINS)
      expect(cs.find((c) => c.id === id)).toMatchObject({ vm: "uvm", receiveOnly: true });
    expect(cs.find((c) => c.id === 1)?.receiveOnly).toBeUndefined();
  });
  it("/tokens returns the native coin with 8 decimals", async () => {
    const t = await (await app.request(`/tokens?chainId=${DOGECOIN}`)).json();
    expect(t).toEqual([expect.objectContaining({ symbol: "DOGE", decimals: 8 })]);
  });
  it("/quotes refuses LTC to LTC with 400 and a clear message", async () => {
    const r = await app.request(
      `/quotes?${new URLSearchParams({ fromChainId: String(LITECOIN), toChainId: String(LITECOIN), fromToken: NON_EVM[LITECOIN]!.native, toToken: NON_EVM[LITECOIN]!.native, amount: "100000000" })}`,
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Litecoin to Litecoin is not a swap/);
  });
  it("/quotes refuses a wrong-chain recipient, quotes a valid one", async () => {
    const q = (recipient: string) =>
      app.request(
        `/quotes?${new URLSearchParams({ fromChainId: "1", toChainId: String(LITECOIN), fromToken: base.fromToken, toToken: NON_EVM[LITECOIN]!.native, amount: base.amount, recipient })}`,
      );
    const bad = await q(DOGE.p2pkh);
    expect(bad.status).toBe(400);
    const good = await q(LTC.p2pkh);
    expect(good.status).toBe(200);
    const body = (await good.json()) as { quotes: { provider: string; toAmount: string }[] };
    expect(body.quotes[0]).toMatchObject({ provider: "thorchain", toAmount: "123456789" });
  });
  it("/build refuses an invalid UTXO recipient", async () => {
    const r = await app.request(
      `/quotes?${new URLSearchParams({ fromChainId: "1", toChainId: String(BITCOIN_CASH), fromToken: base.fromToken, toToken: NON_EVM[BITCOIN_CASH]!.native, amount: base.amount })}`,
    );
    const id = ((await r.json()) as { quotes: { id: string }[] }).quotes[0]!.id;
    const b = await app.request("/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId: id, taker: TAKER, recipient: BCH.legacy }),
    });
    expect(b.status).toBe(400);
    expect((await b.json()).error).toMatch(/CashAddr/);
  });
});
