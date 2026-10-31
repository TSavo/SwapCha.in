import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  keccak256,
  maxUint256,
  pad,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  toHex,
  decodeFunctionData as vDec,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData as btDec } from "./blocktools.js";

// Only the RPC layer is mocked. Factory / vault reads answer like the real contracts would.
type Log = { address: string; topics: string[]; data: string };
const rpc = { logs: [] as Log[], status: "0x1" };
// Morpho Blue idToMarketParams(id) answers: id -> abi-encoded params (filled in below).
const blueMarkets = new Map<string, string>();
const ID_TO_MP = toFunctionSelector("function idToMarketParams(bytes32)");
const ME = "0x803b80fc7f3c67f9ace73750239c60dd764b2ce5";
const ATTACKER = "0x000000000000000000000000000000000000dead";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const VAULT = "0x1111111111111111111111111111111111111111"; // factory-confirmed MetaMorpho vault
const FAKE_VAULT = "0x2222222222222222222222222222222222222222"; // lookalike, not from the factory
const AUSDC = "0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c";
const MARKET = "0x3333333333333333333333333333333333333333";
const PT = "0x4444444444444444444444444444444444444444";
const SY = "0x5555555555555555555555555555555555555555";
const YT = "0x6666666666666666666666666666666666666666";
const REWARD = "0x7777777777777777777777777777777777777777";
const POOL = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
const BLUE = "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb";
const MM_FACTORY = "0x1897a8997241c1cd4bd0698647e4eb7213535c24";
const BUNDLER3 = "0x6566194141eefa99af43bb5aa71460ca2dc90245";
const ADAPTER = "0x4a6c312ec70e8747a587ee860a0353cd42be0ae0";
const MERKL = "0x3ef3d8ba38ebe18db133cec108f4d14ce00dd9ae";
const ROUTER = "0x888888888889758f76e7103c6cbf23abbf58f946";
const PENDLE_MF_V6 = "0x6d247b1c044fa1e22e6b04fa9f71baf99eb29a9f";

const w = (a: string) => pad(a as Hex, { size: 32 }).slice(2);
const T = `0x${"0".repeat(63)}1`;
const F = `0x${"0".repeat(64)}`;
vi.mock("./onchain.js", async (orig) => {
  const m = await orig<typeof import("./onchain.js")>();
  return {
    ...m,
    evmClient: () =>
      ({
        getCode: async () => "0x6080",
        getStorageAt: async () => `0x${"00".repeat(32)}`,
        request: async () => [{ calls: [{ status: rpc.status, logs: rpc.logs }] }],
        call: async ({ to, data }: { to: string; data: string }) => {
          const sel = data.slice(0, 10);
          const arg = `0x${data.slice(34, 74)}`;
          const t = to.toLowerCase();
          if (sel === ID_TO_MP)
            return { data: `0x${blueMarkets.get(`0x${data.slice(10, 74)}`) ?? "0".repeat(320)}` };
          if (sel === "0x29b5352c") return { data: t === MM_FACTORY && arg === VAULT ? T : F };
          if (sel === "0x38d52e0f") return { data: `0x${w(USDC)}` };
          if (sel === "0x58e6309f") return { data: t === PENDLE_MF_V6 && arg === MARKET ? T : F };
          if (sel === "0x2c8ce6bc") return { data: `0x${w(SY)}${w(PT)}${w(YT)}` };
          if (sel === "0x35ea6a75")
            return {
              data: `0x${Array.from({ length: 15 }, (_, i) => (i === 8 ? w(AUSDC) : "0".repeat(64))).join("")}`,
            };
          return { data: "0x" };
        },
      }) as never,
  };
});

import { makeVerifyGuard } from "./agent-guard.js";
import {
  blueMarketId,
  decodeLending,
  LENDING_ABIS as L,
  type MarketParams,
  MORPHO_API_LIMITS,
} from "./lending.js";
import { verifyEvm } from "./txtools.js";

const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const ZERO = "0x0000000000000000000000000000000000000000";
const xfer = (tok: string, from: string, to: string): Log => ({
  address: tok,
  topics: [TRANSFER, pad(from as Hex, { size: 32 }), pad(to as Hex, { size: 32 })],
  data: toHex(10n ** 6n, { size: 32 }),
});
// Network: only Morpho's market API answers (listed markets below); everything else is offline.
const listed = new Set<string>();
const api = { hang: false, calls: 0 };
const nf = (async (url: string, init?: { body?: string }) => {
  if (!String(url).includes("api.morpho.org")) throw new Error("no network");
  api.calls++;
  if (api.hang) return new Promise(() => {}); // never answers, ignores the abort signal
  const id = /uniqueKey_in:\["(0x[0-9a-f]+)"/.exec(JSON.parse(init?.body ?? "{}").query)?.[1];
  const mp = [...registered].find((m) => blueMarketId(m) === id);
  const items =
    mp && id && listed.has(id)
      ? [
          {
            marketId: id,
            listed: true,
            lltv: String(mp.lltv),
            irmAddress: mp.irm,
            oracle: { address: mp.oracle },
            loanAsset: { address: mp.loanToken },
            collateralAsset: { address: mp.collateralToken },
          },
        ]
      : [];
  return new Response(JSON.stringify({ data: { markets: { items } } }));
}) as never;
const registered = new Set<MarketParams>();
/** Create a market on the mocked Morpho Blue; `list` = Morpho's API lists it. */
const market = (mp: MarketParams, list: boolean) => {
  registered.add(mp);
  const id = blueMarketId(mp);
  blueMarkets.set(
    id,
    [
      w(mp.loanToken),
      w(mp.collateralToken),
      w(mp.oracle),
      w(mp.irm),
      toHex(mp.lltv, { size: 32 }).slice(2),
    ].join(""),
  );
  if (list) listed.add(id);
};
const v = async (to: string, data: Hex) =>
  (await verifyEvm(nf, {}, 1, { from: ME, to, data, value: "0" }, { recipient: ME })) as {
    verdict: string;
    findings: { severity: string; check: string }[];
  };
const enc = (abi: readonly unknown[], functionName: string, args: unknown[]) =>
  encodeFunctionData({
    abi: abi as never,
    functionName: functionName as never,
    args: args as never,
  });
const MP = {
  loanToken: USDC,
  collateralToken: WETH,
  oracle: ADAPTER,
  irm: ADAPTER,
  lltv: 860000000000000000n,
};
market(MP, true);
const MP_EVIL = { ...MP, oracle: ATTACKER, collateralToken: REWARD };
market(MP_EVIL, false);
const MP_GHOST = { ...MP, lltv: 1n }; // never created on Blue
const ERC20 = parseAbi(["function approve(address spender, uint256 amount)"]);
const tokenIn = {
  tokenIn: USDC,
  netTokenIn: 10n ** 6n,
  tokenMintSy: USDC,
  pendleSwap: ZERO,
  swapData: { swapType: 0, extRouter: ZERO, extCalldata: "0x", needScale: false },
};
const NOT_DANGER = ["ok", "caution"];

beforeEach(() => {
  rpc.logs = [];
  rpc.status = "0x1";
  api.hang = false;
  api.calls = 0;
});

describe("ERC-4626 (Morpho vaults)", () => {
  const dep = (receiver: string) => enc(L.ERC4626, "deposit", [10n ** 6n, receiver]);
  it("deposit into a factory-confirmed vault, shares to me -> not danger", async () => {
    rpc.logs = [xfer(USDC, ME, VAULT), xfer(VAULT, ZERO, ME)];
    expect(NOT_DANGER).toContain((await v(VAULT, dep(ME))).verdict);
  });
  it("deposit with an attacker receiver -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, VAULT), xfer(VAULT, ZERO, ATTACKER)];
    expect((await v(VAULT, dep(ATTACKER))).verdict).toBe("danger");
  });
  it("lookalike vault not confirmed by Morpho's factory -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, FAKE_VAULT), xfer(FAKE_VAULT, ZERO, ME)];
    expect((await v(FAKE_VAULT, dep(ME))).verdict).toBe("danger");
  });
  it("deposit that also pulls a token other than the vault asset -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, VAULT), xfer(WETH, ME, ATTACKER), xfer(VAULT, ZERO, ME)];
    expect((await v(VAULT, dep(ME))).verdict).toBe("danger");
  });
  it("redeem with owner = me but receiver = attacker -> danger", async () => {
    rpc.logs = [xfer(VAULT, ME, ZERO), xfer(USDC, VAULT, ATTACKER)];
    expect((await v(VAULT, enc(L.ERC4626, "redeem", [1n, ATTACKER, ME]))).verdict).toBe("danger");
  });
  it("withdraw to me -> not danger", async () => {
    rpc.logs = [xfer(VAULT, ME, ZERO), xfer(USDC, VAULT, ME)];
    expect(NOT_DANGER).toContain(
      (await v(VAULT, enc(L.ERC4626, "withdraw", [1n, ME, ME]))).verdict,
    );
  });
});

describe("Aave v3 Pool", () => {
  it("supply for me (aToken minted to me) -> not danger", async () => {
    rpc.logs = [xfer(USDC, ME, AUSDC), xfer(AUSDC, ZERO, ME)];
    expect(NOT_DANGER).toContain(
      (await v(POOL, enc(L.AAVE_POOL, "supply", [USDC, 10n ** 6n, ME, 0]))).verdict,
    );
  });
  it("supply onBehalfOf an attacker -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, AUSDC), xfer(AUSDC, ZERO, ATTACKER)];
    expect(
      (await v(POOL, enc(L.AAVE_POOL, "supply", [USDC, 10n ** 6n, ATTACKER, 0]))).verdict,
    ).toBe("danger");
  });
  it("borrow for me -> not danger; onBehalfOf attacker -> danger", async () => {
    rpc.logs = [xfer(USDC, AUSDC, ME)];
    expect(NOT_DANGER).toContain(
      (await v(POOL, enc(L.AAVE_POOL, "borrow", [USDC, 1n, 2n, 0, ME]))).verdict,
    );
    expect((await v(POOL, enc(L.AAVE_POOL, "borrow", [USDC, 1n, 2n, 0, ATTACKER]))).verdict).toBe(
      "danger",
    );
  });
  it("repay my debt (nothing comes back) -> not danger", async () => {
    rpc.logs = [xfer(USDC, ME, AUSDC)];
    expect(NOT_DANGER).toContain(
      (await v(POOL, enc(L.AAVE_POOL, "repay", [USDC, 1n, 2n, ME]))).verdict,
    );
  });
  it("withdraw to an attacker -> danger", async () => {
    rpc.logs = [xfer(AUSDC, ME, ZERO), xfer(USDC, AUSDC, ATTACKER)];
    expect((await v(POOL, enc(L.AAVE_POOL, "withdraw", [USDC, 1n, ATTACKER]))).verdict).toBe(
      "danger",
    );
  });
  it("Aave calldata sent to a lookalike pool -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, FAKE_VAULT), xfer(AUSDC, ZERO, ME)];
    expect((await v(FAKE_VAULT, enc(L.AAVE_POOL, "supply", [USDC, 1n, ME, 0]))).verdict).toBe(
      "danger",
    );
  });
});

describe("Morpho Blue", () => {
  it("supplyCollateral for me -> not danger", async () => {
    rpc.logs = [xfer(WETH, ME, BLUE)];
    expect(NOT_DANGER).toContain(
      (await v(BLUE, enc(L.MORPHO_BLUE, "supplyCollateral", [MP, 1n, ME, "0x"]))).verdict,
    );
  });
  it("borrow to me -> not danger; receiver attacker -> danger; onBehalf attacker -> danger", async () => {
    rpc.logs = [xfer(USDC, BLUE, ME)];
    expect(NOT_DANGER).toContain(
      (await v(BLUE, enc(L.MORPHO_BLUE, "borrow", [MP, 1n, 0n, ME, ME]))).verdict,
    );
    expect((await v(BLUE, enc(L.MORPHO_BLUE, "borrow", [MP, 1n, 0n, ME, ATTACKER]))).verdict).toBe(
      "danger",
    );
    expect(
      (await v(BLUE, enc(L.MORPHO_BLUE, "supply", [MP, 1n, 0n, ATTACKER, "0x"]))).verdict,
    ).toBe("danger");
  });
  it("repay for me -> not danger", async () => {
    rpc.logs = [xfer(USDC, ME, BLUE)];
    expect(NOT_DANGER).toContain(
      (await v(BLUE, enc(L.MORPHO_BLUE, "repay", [MP, 1n, 0n, ME, "0x"]))).verdict,
    );
  });
});

describe("Morpho Blue market verification (G1)", () => {
  it("supply into an unlisted market with an attacker oracle -> danger, 'market not verified'", async () => {
    rpc.logs = [xfer(USDC, ME, BLUE)];
    const r = await v(BLUE, enc(L.MORPHO_BLUE, "supply", [MP_EVIL, 10n ** 6n, 0n, ME, "0x"]));
    expect(r.verdict).toBe("danger");
    expect(JSON.stringify(r.findings)).toContain("market not verified");
  });
  it("supplyCollateral into an unlisted market -> danger", async () => {
    rpc.logs = [xfer(REWARD, ME, BLUE)];
    expect(
      (await v(BLUE, enc(L.MORPHO_BLUE, "supplyCollateral", [MP_EVIL, 1n, ME, "0x"]))).verdict,
    ).toBe("danger");
  });
  it("market that does not exist on Blue -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, BLUE)];
    expect(
      (await v(BLUE, enc(L.MORPHO_BLUE, "supply", [MP_GHOST, 1n, 0n, ME, "0x"]))).verdict,
    ).toBe("danger");
  });
  it("borrow / repay / withdraw on an unlisted market -> caution with 'market not verified'", async () => {
    for (const [fn, args, logs] of [
      ["borrow", [MP_EVIL, 1n, 0n, ME, ME], [xfer(USDC, BLUE, ME)]],
      ["withdraw", [MP_EVIL, 1n, 0n, ME, ME], [xfer(USDC, BLUE, ME)]],
      ["repay", [MP_EVIL, 1n, 0n, ME, "0x"], [xfer(USDC, ME, BLUE)]],
    ] as const) {
      rpc.logs = [...logs];
      const r = await v(BLUE, enc(L.MORPHO_BLUE, fn, [...args]));
      expect(r.verdict).toBe("caution");
      expect(JSON.stringify(r.findings)).toContain("market not verified");
    }
  });
});

describe("Merkl claim", () => {
  const claim = (u: string) => enc(L.MERKL, "claim", [[u], [REWARD], [1n], [[]]]);
  it("claim for me -> not danger", async () => {
    rpc.logs = [xfer(REWARD, MERKL, ME)];
    expect(NOT_DANGER).toContain((await v(MERKL, claim(ME))).verdict);
  });
  it("Merkl claim selector on a non-Distributor contract -> danger (G4)", async () => {
    rpc.logs = [xfer(REWARD, FAKE_VAULT, ME)];
    expect((await v(FAKE_VAULT, claim(ME))).verdict).toBe("danger");
  });
  it("claim for an attacker -> danger", async () => {
    rpc.logs = [xfer(REWARD, MERKL, ATTACKER)];
    expect((await v(MERKL, claim(ATTACKER))).verdict).toBe("danger");
  });
});

describe("Pendle router", () => {
  const buy = (r: string, m = MARKET) =>
    enc(L.PENDLE_ROUTER, "swapExactTokenForPtSimple", [r, m, 1n, tokenIn]);
  it("buy PT on a factory-confirmed market, to me -> not danger", async () => {
    rpc.logs = [xfer(USDC, ME, ROUTER), xfer(PT, MARKET, ME)];
    expect(NOT_DANGER).toContain((await v(ROUTER, buy(ME))).verdict);
  });
  it("receiver attacker -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, ROUTER), xfer(PT, MARKET, ATTACKER)];
    expect((await v(ROUTER, buy(ATTACKER))).verdict).toBe("danger");
  });
  it("market not from Pendle's factory -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, ROUTER), xfer(FAKE_VAULT, FAKE_VAULT, ME)];
    expect((await v(ROUTER, buy(ME, FAKE_VAULT))).verdict).toBe("danger");
  });
  it("buy PT that also pulls WETH to an attacker -> danger (G22)", async () => {
    rpc.logs = [xfer(USDC, ME, ROUTER), xfer(WETH, ME, ATTACKER), xfer(PT, MARKET, ME)];
    expect((await v(ROUTER, buy(ME))).verdict).toBe("danger");
  });
  it("buy PT that pulls more input than declared -> danger (G22)", async () => {
    rpc.logs = [
      { ...xfer(USDC, ME, ROUTER), data: toHex(5n * 10n ** 6n, { size: 32 }) },
      xfer(PT, MARKET, ME),
    ];
    expect((await v(ROUTER, buy(ME))).verdict).toBe("danger");
  });
  it("TokenInput routed through an attacker pendleSwap / extRouter -> danger (G23)", async () => {
    rpc.logs = [xfer(USDC, ME, ROUTER), xfer(PT, MARKET, ME)];
    const evil = {
      ...tokenIn,
      pendleSwap: ATTACKER,
      swapData: { swapType: 1, extRouter: ATTACKER, extCalldata: "0x1234", needScale: false },
    };
    const r = await v(
      ROUTER,
      enc(L.PENDLE_ROUTER, "swapExactTokenForPtSimple", [ME, MARKET, 1n, evil]),
    );
    expect(r.verdict).toBe("danger");
    expect(r.findings.some((f) => f.check === "lending-route")).toBe(true);
    const onlyRouter = { ...tokenIn, swapData: { ...tokenIn.swapData, extRouter: ATTACKER } };
    expect(
      (
        await v(
          ROUTER,
          enc(L.PENDLE_ROUTER, "swapExactTokenForPtSimple", [ME, MARKET, 1n, onlyRouter]),
        )
      ).verdict,
    ).toBe("danger");
  });
  it("decodes the full swapExactTokenForPt signature", () => {
    const lim = {
      limitRouter: ZERO,
      epsSkipMarket: 0n,
      normalFills: [],
      flashFills: [],
      optData: "0x",
    };
    const ap = {
      guessMin: 0n,
      guessMax: maxUint256,
      guessOffchain: 0n,
      maxIteration: 256n,
      eps: 10n ** 14n,
    };
    const d = decodeLending(
      enc(L.PENDLE_ROUTER, "swapExactTokenForPt", [ATTACKER, MARKET, 1n, ap, tokenIn, lim]),
    );
    expect(d?.beneficiaries[0]?.address.toLowerCase()).toBe(ATTACKER);
  });
});

describe("Morpho Bundler3", () => {
  const GA = L.GENERAL_ADAPTER1;
  const step = (data: Hex, to = ADAPTER) => ({
    to,
    data,
    value: 0n,
    skipRevert: false,
    callbackHash: F,
  });
  const pull = (tok: string, to = ADAPTER, amt = 10n ** 6n) =>
    enc(GA, "erc20TransferFrom", [tok, to, amt]);
  const deposit = (receiver = ME) =>
    enc(GA, "erc4626Deposit", [VAULT, 10n ** 6n, 10n ** 27n, receiver]);
  const bundle = (...steps: ReturnType<typeof step>[]) => enc(L.BUNDLER3, "multicall", [steps]);
  const good = () => bundle(step(pull(USDC)), step(deposit()));
  it("pull USDC + deposit into a confirmed vault for me -> not danger", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(VAULT, ZERO, ME)];
    expect(NOT_DANGER).toContain((await v(BUNDLER3, good())).verdict);
  });
  it("bundle that calls a non-Morpho contract -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(VAULT, ZERO, ME)];
    expect((await v(BUNDLER3, bundle(step(pull(USDC)), step(deposit(), ATTACKER)))).verdict).toBe(
      "danger",
    );
  });
  it("bundle that reverts in simulation -> danger", async () => {
    rpc.status = "0x0";
    expect((await v(BUNDLER3, good())).verdict).toBe("danger");
  });
  it("real deposit + erc20TransferFrom(WETH -> attacker) -> danger (G2)", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(VAULT, ZERO, ME), xfer(WETH, ME, ATTACKER)];
    const r = await v(
      BUNDLER3,
      bundle(step(pull(USDC)), step(deposit()), step(pull(WETH, ATTACKER))),
    );
    expect(r.verdict).toBe("danger");
  });
  it("WETH leaves the wallet without a declared pull (hidden by share gain) -> danger (G2)", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(VAULT, ZERO, ME), xfer(WETH, ME, ATTACKER)];
    const r = await v(BUNDLER3, good());
    expect(r.verdict).toBe("danger");
    expect(r.findings.some((f) => f.check === "lending-spend")).toBe(true);
  });
  it("pull WETH to the adapter, then erc20Transfer it to an attacker -> danger (G2)", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(WETH, ME, ADAPTER), xfer(VAULT, ZERO, ME)];
    const r = await v(
      BUNDLER3,
      bundle(
        step(pull(USDC)),
        step(pull(WETH)),
        step(enc(GA, "erc20Transfer", [WETH, ATTACKER, 10n ** 6n])),
        step(deposit()),
      ),
    );
    expect(r.verdict).toBe("danger");
  });
  it("deposit with an attacker receiver inside the bundle -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(VAULT, ZERO, ATTACKER)];
    expect((await v(BUNDLER3, bundle(step(pull(USDC)), step(deposit(ATTACKER))))).verdict).toBe(
      "danger",
    );
  });
  it("morphoSupply into an unlisted market inside the bundle -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(USDC, ADAPTER, BLUE)];
    const sup = enc(GA, "morphoSupply", [MP_EVIL, 10n ** 6n, 0n, maxUint256, ME, "0x"]);
    expect((await v(BUNDLER3, bundle(step(pull(USDC)), step(sup)))).verdict).toBe("danger");
  });
});

describe("approvals", () => {
  it("exact approve to the Aave pool -> ok", async () => {
    const r = await v(USDC, enc(ERC20, "approve", [POOL, 10n ** 6n]));
    expect(r.verdict).toBe("ok");
  });
  it("exact approve to a factory-confirmed vault -> ok", async () => {
    expect((await v(USDC, enc(ERC20, "approve", [VAULT, 10n ** 6n]))).verdict).toBe("ok");
  });
  it("exact approve to an unknown spender -> caution", async () => {
    expect((await v(USDC, enc(ERC20, "approve", [FAKE_VAULT, 10n ** 6n]))).verdict).toBe("caution");
  });
  it("unlimited approve to an allowlisted spender -> danger", async () => {
    expect((await v(USDC, enc(ERC20, "approve", [POOL, maxUint256]))).verdict).toBe("danger");
  });
});

describe("through the agent guard (owner = beneficiary)", () => {
  const g = makeVerifyGuard(nf, {});
  it("Aave supply for the owner -> not danger; for an attacker -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, AUSDC), xfer(AUSDC, ZERO, ME)];
    const ok = await g(
      1,
      { to: POOL, data: enc(L.AAVE_POOL, "supply", [USDC, 1n, ME, 0]), value: "0" } as never,
      ME,
    );
    expect(NOT_DANGER).toContain(ok.verdict);
    const bad = await g(
      1,
      { to: POOL, data: enc(L.AAVE_POOL, "supply", [USDC, 1n, ATTACKER, 0]), value: "0" } as never,
      ME,
    );
    expect(bad.verdict).toBe("danger");
  });
});

describe("Morpho API hang bounds", () => {
  const GA = L.GENERAL_ADAPTER1;
  const BUNDLE = "0x6566194141eefa99af43bb5aa71460ca2dc90245";
  const ADP = "0x4a6c312ec70e8747a587ee860a0353cd42be0ae0";
  const st = (data: Hex) => ({ to: ADP, data, value: 0n, skipRevert: false, callbackHash: F });
  const repay = (mp: MarketParams) =>
    st(enc(GA, "morphoRepay", [mp, 1n, 0n, maxUint256, ME, "0x"]));
  const saved = { ...MORPHO_API_LIMITS };
  const timed = async (data: Hex) => {
    const t0 = Date.now();
    const r = await v(BUNDLE, data);
    return { r, ms: Date.now() - t0 };
  };
  beforeEach(() => {
    MORPHO_API_LIMITS.perCallMs = 300;
    MORPHO_API_LIMITS.totalMs = 450;
    rpc.logs = [xfer(USDC, ME, ADP), xfer(USDC, ADP, BLUE)];
  });
  afterEach(() => Object.assign(MORPHO_API_LIMITS, saved));
  const pullUsdc = st(enc(GA, "erc20TransferFrom", [USDC, ADP, 10n ** 6n]));
  for (const n of [4, 32]) {
    it(`hung API, ${n} same-market steps -> one request, about one timeout, not verified`, async () => {
      api.hang = true;
      const steps = [pullUsdc, ...Array.from({ length: n - 1 }, () => repay(MP_EVIL))];
      const { r, ms } = await timed(enc(L.BUNDLER3, "multicall", [steps]));
      expect(api.calls).toBe(1);
      expect(ms).toBeLessThan(1000);
      expect(r.verdict).toBe("caution");
      expect(JSON.stringify(r.findings)).toContain("market not verified");
    });
  }
  it("hung API, 200 same-market steps -> refused as too many steps, no API wait", async () => {
    api.hang = true;
    const steps = [pullUsdc, ...Array.from({ length: 199 }, () => repay(MP_EVIL))];
    const { r, ms } = await timed(enc(L.BUNDLER3, "multicall", [steps]));
    expect(ms).toBeLessThan(1000);
    expect(r.verdict).toBe("danger");
    expect(JSON.stringify(r.findings)).toContain("too many bundle steps");
  });
  it("hung API, different markets share one overall deadline", async () => {
    api.hang = true;
    const mps = Array.from({ length: 10 }, (_, i) => ({ ...MP_EVIL, lltv: BigInt(i + 2) }));
    for (const m of mps) market(m, false);
    const steps = [pullUsdc, ...mps.map(repay)];
    const { r, ms } = await timed(enc(L.BUNDLER3, "multicall", [steps]));
    expect(ms).toBeLessThan(1000); // 10 x 300ms per-call would be 3s
    expect(api.calls).toBeLessThanOrEqual(2);
    expect(r.verdict).toBe("caution");
  });
  it("33 steps -> danger 'too many bundle steps'", async () => {
    const steps = [pullUsdc, ...Array.from({ length: 32 }, () => repay(MP))];
    const { r } = await timed(enc(L.BUNDLER3, "multicall", [steps]));
    expect(r.verdict).toBe("danger");
    expect(JSON.stringify(r.findings)).toContain("too many bundle steps");
  });
  it("listed market, API answering -> unchanged (not danger, one request)", async () => {
    const steps = [pullUsdc, repay(MP), repay(MP)];
    const { r } = await timed(enc(L.BUNDLER3, "multicall", [steps]));
    expect(NOT_DANGER).toContain(r.verdict);
    expect(api.calls).toBe(1);
  });
});

describe("blueMarketId: blocktools abi.encode + keccak256 is byte-identical to viem", () => {
  // morpho-blue MarketParamsLib: id = keccak256(abi.encode(marketParams)). blueMarketId now runs
  // this in the blocktools WASM; prove it equals the viem computation so every market-gate decision
  // keyed on the id is unchanged. Ground truth is viem's own encodeAbiParameters.
  const viemMarketId = (mp: MarketParams): Hex =>
    keccak256(
      encodeAbiParameters(parseAbiParameters("address, address, address, address, uint256"), [
        mp.loanToken as Hex,
        mp.collateralToken as Hex,
        mp.oracle as Hex,
        mp.irm as Hex,
        mp.lltv,
      ]),
    );
  it("matches viem across varied market params", () => {
    const cases: MarketParams[] = [
      MP,
      MP_EVIL,
      MP_GHOST,
      { loanToken: WETH, collateralToken: USDC, oracle: ME, irm: ATTACKER, lltv: 0n },
      { loanToken: ZERO, collateralToken: ZERO, oracle: ZERO, irm: ZERO, lltv: maxUint256 },
    ];
    for (const mp of cases) expect(blueMarketId(mp)).toBe(viemMarketId(mp));
  });
});

describe("decodeLending decode: blocktools is value-identical to viem (named fields preserved)", () => {
  // decodeLending now decodes with the blocktools WASM (viem-parity coder). This proves the decoded
  // values — including the NAMED struct fields decodeLending reads (mp.loanToken, tin.tokenIn,
  // t.pendleSwap, t.swapData.swapType, ...) — are byte-for-byte what viem returns, so no guard
  // decision changes. Ground truth is viem's own decodeFunctionData on the same ABIs viem encoded.
  let seed = 0x1e4d1a9b;
  const rnd = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return seed / 2 ** 32;
  };
  const ri = (n: number) => Math.floor(rnd() * n);
  const rbytes = (n: number) => toHex(Uint8Array.from({ length: n }, () => ri(256)));
  type P = { type: string; name?: string; components?: readonly P[] };
  const genVal = (p: P): unknown => {
    const arr = /^(.*)\[(\d*)\]$/.exec(p.type);
    if (arr)
      return Array.from({ length: arr[2] ? Number(arr[2]) : ri(3) }, () =>
        genVal({ ...p, type: arr[1]! }),
      );
    if (p.type === "tuple")
      return Object.fromEntries((p.components ?? []).map((c) => [c.name, genVal(c)]));
    const m = /^(u?)int(\d+)$/.exec(p.type);
    if (m) {
      const bits = BigInt(m[2]!);
      const max = m[1] ? 2n ** bits - 1n : 2n ** (bits - 1n) - 1n;
      const min = m[1] ? 0n : -(2n ** (bits - 1n));
      const edge = ri(3);
      if (edge === 0) return max;
      if (edge === 1) return min;
      return min + (BigInt(rbytes(Number(bits) / 8)) % (max - min + 1n));
    }
    if (p.type === "address") return getAddress(rbytes(20));
    if (p.type === "bool") return ri(2) === 1;
    if (p.type === "bytes") return rbytes(ri(40));
    if (p.type === "string") return ["", "héllo ✓", "a".repeat(ri(20))][ri(3)];
    const n = /^bytes(\d+)$/.exec(p.type);
    if (n) return rbytes(Number(n![1]));
    throw new Error(`unhandled type ${p.type}`);
  };

  // Exactly the ABIs decodeLending / the bundler step decoder feed to decodeFunctionData. READS is
  // excluded: it is only ever encoded for an eth_call and read back with decodeFunctionResult, never
  // decoded here (and its zero-arg asset()/SY()/PT() are the one spot where viem returns args
  // `undefined` while the wrapper returns `[]` — irrelevant since no decode target is zero-arg).
  const DECODE_ABIS = [
    L.ERC4626,
    L.MORPHO_BLUE,
    L.AAVE_POOL,
    L.MERKL,
    L.PENDLE_ROUTER,
    L.BUNDLER3,
    L.GENERAL_ADAPTER1,
  ];
  it("matches viem on every function of every lending ABI (30 random calls each)", () => {
    let fns = 0;
    for (const abi of DECODE_ABIS) {
      for (const item of abi as readonly P[]) {
        if ((item as { type: string }).type !== "function") continue;
        const inputs = (item as { inputs?: readonly P[] }).inputs ?? [];
        for (let i = 0; i < 30; i++) {
          const args = inputs.map(genVal);
          const data = encodeFunctionData({
            abi: abi as never,
            functionName: (item as { name: string }).name as never,
            args: args as never,
          }) as Hex;
          const v = vDec({ abi: abi as never, data });
          const b = btDec({ abi, data });
          expect(b.functionName).toBe(v.functionName);
          expect(b.args).toEqual(v.args); // deep-equal incl. named tuple objects
        }
        fns++;
      }
    }
    expect(fns).toBeGreaterThan(25);
  });

  it("Morpho Blue supply: named marketParams + onBehalf read identically", () => {
    const data = enc(L.MORPHO_BLUE, "supply", [MP_EVIL, 10n ** 6n, 0n, ATTACKER, "0x"]);
    const b = btDec({ abi: L.MORPHO_BLUE, data });
    expect(b.args).toEqual(vDec({ abi: L.MORPHO_BLUE as never, data }).args);
    const mp = b.args[0] as MarketParams;
    expect(mp.loanToken.toLowerCase()).toBe(USDC);
    expect(mp.collateralToken.toLowerCase()).toBe(REWARD);
    expect(mp.oracle.toLowerCase()).toBe(ATTACKER);
    expect(mp.lltv).toBe(MP_EVIL.lltv);
    expect(String(b.args[3]).toLowerCase()).toBe(ATTACKER); // onBehalf
    // decodeLending reads these same named fields
    const d = decodeLending(data);
    expect(d?.beneficiaries.find((x) => x.role === "onBehalf")?.address.toLowerCase()).toBe(
      ATTACKER,
    );
  });

  it("Pendle swapExactTokenForPt: nested TokenInput.swapData fields read identically", () => {
    const lim = {
      limitRouter: ZERO,
      epsSkipMarket: 0n,
      normalFills: [],
      flashFills: [],
      optData: "0x",
    };
    const ap = {
      guessMin: 0n,
      guessMax: maxUint256,
      guessOffchain: 0n,
      maxIteration: 256n,
      eps: 10n ** 14n,
    };
    const evilIn = {
      ...tokenIn,
      pendleSwap: ATTACKER,
      swapData: { swapType: 2, extRouter: ATTACKER, extCalldata: "0xdead", needScale: true },
    };
    const data = enc(L.PENDLE_ROUTER, "swapExactTokenForPt", [ME, MARKET, 1n, ap, evilIn, lim]);
    const b = btDec({ abi: L.PENDLE_ROUTER, data });
    expect(b.args).toEqual(vDec({ abi: L.PENDLE_ROUTER as never, data }).args);
    const tin = b.args[4] as {
      tokenIn: string;
      netTokenIn: bigint;
      pendleSwap: string;
      swapData: { swapType: number; extRouter: string; extCalldata: string; needScale: boolean };
    };
    expect(tin.tokenIn.toLowerCase()).toBe(USDC);
    expect(tin.netTokenIn).toBe(tokenIn.netTokenIn);
    expect(tin.pendleSwap.toLowerCase()).toBe(ATTACKER);
    expect(tin.swapData.swapType).toBe(2);
    expect(tin.swapData.extRouter.toLowerCase()).toBe(ATTACKER);
    expect(tin.swapData.needScale).toBe(true);
    expect(String(b.args[0]).toLowerCase()).toBe(ME); // receiver
  });

  it("GeneralAdapter1 erc4626Deposit + morphoWithdraw: named fields read identically", () => {
    const dep = enc(L.GENERAL_ADAPTER1, "erc4626Deposit", [VAULT, 10n ** 6n, 10n ** 27n, ME]);
    expect(btDec({ abi: L.GENERAL_ADAPTER1, data: dep }).args).toEqual(
      vDec({ abi: L.GENERAL_ADAPTER1 as never, data: dep }).args,
    );
    const wd = enc(L.GENERAL_ADAPTER1, "morphoWithdraw", [MP, 1n, 0n, 0n, ME]);
    const b = btDec({ abi: L.GENERAL_ADAPTER1, data: wd });
    expect(b.args).toEqual(vDec({ abi: L.GENERAL_ADAPTER1 as never, data: wd }).args);
    expect((b.args[0] as MarketParams).loanToken.toLowerCase()).toBe(USDC);
  });

  it("throws (like viem) on calldata that matches no lending ABI function", () => {
    expect(() => btDec({ abi: L.ERC4626, data: "0xdeadbeef" })).toThrow();
  });
});

describe("guard deadline", () => {
  it("a guard run past its deadline throws (the runner then refuses with its fixed message)", async () => {
    api.hang = true;
    MORPHO_API_LIMITS.perCallMs = 5000;
    MORPHO_API_LIMITS.totalMs = 6000;
    const g = makeVerifyGuard(nf, {}, 100);
    const data = enc(L.MORPHO_BLUE, "supply", [MP_EVIL, 1n, 0n, ME, "0x"]);
    const t0 = Date.now();
    await expect(g(1, { to: BLUE, data, value: "0" } as never, ME)).rejects.toThrow(
      "guard deadline exceeded",
    );
    expect(Date.now() - t0).toBeLessThan(1000);
    MORPHO_API_LIMITS.perCallMs = 5000;
    MORPHO_API_LIMITS.totalMs = 6000;
  });
});
