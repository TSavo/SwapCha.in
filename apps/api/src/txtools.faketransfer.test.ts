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

import { usdcOf } from "./onchain.js";
import { verifyEvm } from "./txtools.js";

const ME = "0x803b80fc7f3c67f9ace73750239c60dd764b2ce5";
const ATTACKER = "0x000000000000000000000000000000000000dead";
const JUNK = "0x1234567890123456789012345678901234567890";
const ROUTER = "0x2222222222222222222222222222222222222222";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const USDC = usdcOf(1)!.toLowerCase();
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const t = (a: string) => pad(a as `0x${string}`, { size: 32 });
const xfer = (tok: string, from: string, to: string, amt = 10n ** 18n): Log => ({
  address: tok,
  topics: [TRANSFER, t(from), t(to)],
  data: toHex(amt, { size: 32 }),
});
const f = (async () => {
  throw new Error("no network");
}) as never;
const v = (exp: Record<string, string> = {}) =>
  verifyEvm(
    f,
    {},
    1,
    { from: ME, to: ROUTER, data: "0x12345678", value: "1000000000000000000" },
    exp,
  );

beforeEach(() => {
  rpc.logs = [];
});

describe("a fake Transfer from a junk token does not cancel a loss", () => {
  it("drain + fake Transfer(attacker -> me) from a junk contract -> danger", async () => {
    rpc.logs = [xfer(NATIVE, ME, ATTACKER), xfer(JUNK, ATTACKER, ME)];
    const r = await v();
    expect(r.verdict).toBe("danger");
    expect(r.findings.some((x) => x.check === "balance-diff")).toBe(true);
  });
  it("same, keyed to me as expected recipient -> danger", async () => {
    rpc.logs = [xfer(USDC, ME, ATTACKER, 10n ** 6n), xfer(JUNK, ATTACKER, ME)];
    expect((await v({ recipient: ME })).verdict).toBe("danger");
  });
  it("legit swap where outToken is the expected asset -> ok", async () => {
    const OUT = "0x3333333333333333333333333333333333333333";
    rpc.logs = [xfer(NATIVE, ME, ROUTER), xfer(OUT, ROUTER, ME, 500n)];
    expect((await v({ recipient: ME, outToken: OUT, minOut: "400" })).verdict).toBe("ok");
  });
  it("legit swap ETH -> listed USDC, no outToken given -> ok", async () => {
    rpc.logs = [xfer(NATIVE, ME, ROUTER), xfer(USDC, ROUTER, ME, 10n ** 6n)];
    expect((await v({ recipient: ME })).verdict).toBe("ok");
  });
});
