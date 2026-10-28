import { keccak256, pad, toHex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Log = { address: string; topics: string[]; data: string };
const rpc = { logs: [] as Log[] };
vi.mock("./onchain.js", async (orig) => {
  const m = await orig<typeof import("./onchain.js")>();
  return {
    ...m,
    evmClient: () =>
      ({
        getCode: async () => "0x6080",
        getStorageAt: async () => `0x${"00".repeat(32)}`,
        request: async () => [{ calls: [{ status: "0x1", logs: rpc.logs }] }],
        call: async () => "0x",
      }) as never,
  };
});

import { verifyEvm, WRAPPED_NATIVE } from "./txtools.js";

const ME = "0x803b80fc7f3c67f9ace73750239c60dd764b2ce5";
const ATTACKER = "0x000000000000000000000000000000000000dead";
const JUNK = "0x1234567890123456789012345678901234567890";
const WETH1 = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const DEPOSIT = keccak256(toHex("Deposit(address,uint256)"));
const WITHDRAWAL = keccak256(toHex("Withdrawal(address,uint256)"));
const t = (a: string) => pad(a as `0x${string}`, { size: 32 });
const amt = toHex(10n ** 18n, { size: 32 });
const xfer = (tok: string, from: string, to: string): Log => ({
  address: tok,
  topics: [TRANSFER, t(from), t(to)],
  data: amt,
});
const ev = (tok: string, topic: string, who: string): Log => ({
  address: tok,
  topics: [topic, t(who)],
  data: amt,
});
const f = (async () => {
  throw new Error("no network");
}) as never;
const v = (chainId: number, to: string, value = "0", data = "0xd0e30db0") =>
  verifyEvm(f, {}, chainId, { from: ME, to, data, value }, { recipient: ME });

beforeEach(() => {
  rpc.logs = [];
});

describe("WETH Deposit/Withdrawal only from the chain's canonical wrapped-native contract", () => {
  it("drain + fake Deposit(me) from a junk contract -> still danger", async () => {
    rpc.logs = [xfer(USDC, ME, ATTACKER), ev(JUNK, DEPOSIT, ME)];
    expect((await v(1, JUNK)).verdict).toBe("danger");
  });
  it("drain + fake Withdrawal from a junk contract -> still danger", async () => {
    rpc.logs = [xfer(USDC, ME, ATTACKER), ev(JUNK, WITHDRAWAL, ATTACKER)];
    expect((await v(1, JUNK)).verdict).toBe("danger");
  });
  it("real WETH wrap on the mainnet WETH9 address -> ok", async () => {
    rpc.logs = [
      xfer("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", ME, WETH1),
      ev(WETH1, DEPOSIT, ME),
    ];
    expect((await v(1, WETH1, "1000000000000000000")).verdict).toBe("ok");
  });
  it("mainnet WETH address on another chain is not counted", async () => {
    rpc.logs = [
      xfer("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", ME, WETH1),
      ev(WETH1, DEPOSIT, ME),
    ];
    expect((await v(137, WETH1, "1000000000000000000")).verdict).toBe("danger");
  });
  it("unsupported chains (no verified wrapped-native) have no entry", () => {
    expect(WRAPPED_NATIVE[59144]).toBeUndefined();
    expect(WRAPPED_NATIVE[534352]).toBeUndefined();
    for (const a of Object.values(WRAPPED_NATIVE)) expect(a).toBe(a.toLowerCase());
  });
});
