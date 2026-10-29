import { encodeFunctionData, type Hex, keccak256, maxUint256, pad, parseAbi, toHex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the RPC layer is mocked. Factory / vault reads answer like the real contracts would.
type Log = { address: string; topics: string[]; data: string };
const rpc = { logs: [] as Log[], status: "0x1" };
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
import { decodeLending, LENDING_ABIS as L } from "./lending.js";
import { verifyEvm } from "./txtools.js";

const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const ZERO = "0x0000000000000000000000000000000000000000";
const xfer = (tok: string, from: string, to: string): Log => ({
  address: tok,
  topics: [TRANSFER, pad(from as Hex, { size: 32 }), pad(to as Hex, { size: 32 })],
  data: toHex(10n ** 6n, { size: 32 }),
});
const nf = (async () => {
  throw new Error("no network");
}) as never;
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

describe("Merkl claim", () => {
  const claim = (u: string) => enc(L.MERKL, "claim", [[u], [REWARD], [1n], [[]]]);
  it("claim for me -> not danger", async () => {
    rpc.logs = [xfer(REWARD, MERKL, ME)];
    expect(NOT_DANGER).toContain((await v(MERKL, claim(ME))).verdict);
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
  const bundle = (to: string) =>
    enc(L.BUNDLER3, "multicall", [
      [{ to, data: "0x", value: 0n, skipRevert: false, callbackHash: F }],
    ]);
  it("bundle via the adapter, confirmed vault shares to me -> not danger", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(VAULT, ZERO, ME)];
    expect(NOT_DANGER).toContain((await v(BUNDLER3, bundle(ADAPTER))).verdict);
  });
  it("bundle that calls a non-Morpho contract -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, ADAPTER), xfer(VAULT, ZERO, ME)];
    expect((await v(BUNDLER3, bundle(ATTACKER))).verdict).toBe("danger");
  });
  it("bundle that reverts in simulation -> danger", async () => {
    rpc.status = "0x0";
    expect((await v(BUNDLER3, bundle(ADAPTER))).verdict).toBe("danger");
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
