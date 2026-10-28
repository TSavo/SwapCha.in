import { encodeFunctionData, type Hex, keccak256, maxUint256, pad, parseAbi, toHex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the RPC layer is mocked: verify_tx (calldata checks, eth_simulateV1 log parsing, outcome
// checks, verdict) runs for real behind the real guard the API wires into the orchestrator.
type Log = { address: string; topics: string[]; data: string };
const rpc = {
  simulateCalls: [] as { from?: string; to: string }[],
  logs: [] as Log[],
  status: "0x1",
  code: {} as Record<string, string>,
};
vi.mock("./onchain.js", async (orig) => {
  const m = await orig<typeof import("./onchain.js")>();
  return {
    ...m,
    evmClient: () =>
      ({
        getCode: async ({ address }: { address: string }) =>
          rpc.code[address.toLowerCase()] ?? "0x",
        getStorageAt: async () => `0x${"00".repeat(32)}`,
        request: async ({ method, params }: { method: string; params: unknown[] }) => {
          if (method !== "eth_simulateV1") throw new Error(`unexpected ${method}`);
          const call = (
            params[0] as { blockStateCalls: { calls: { from?: string; to: string }[] }[] }
          ).blockStateCalls[0]!.calls[0]!;
          rpc.simulateCalls.push(call);
          return [{ calls: [{ status: rpc.status, logs: rpc.logs }] }];
        },
        call: async () => {
          throw new Error("eth_call should not be needed");
        },
      }) as never,
  };
});

import { makeVerifyGuard } from "./agent-guard.js";
import { runTurn } from "./agent-runner.js";
import { SessionBus } from "./session-bus.js";
import { openSessionStore } from "./sessions.js";
import type { ProposedAction } from "./wallet-action.js";

const OWNER = "0x803b80fc7f3c67f9ace73750239c60dd764b2ce5";
const ATTACKER = "0x000000000000000000000000000000000000dead";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const NATIVE_LOG = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const DEPOSIT = keccak256(toHex("Deposit(address,uint256)"));
const t = (a: string) => pad(a as Hex, { size: 32 });
const xfer = (token: string, from: string, to: string, amt: bigint): Log => ({
  address: token,
  topics: [TRANSFER, t(from), t(to)],
  data: toHex(amt, { size: 32 }),
});
const abi = parseAbi([
  "function transfer(address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function deposit()",
]);
const guard = makeVerifyGuard(
  (async () => {
    throw new Error("no network in tests");
  }) as never,
  {},
);

async function turn(tx: { to: string; data?: string; value?: string }) {
  const store = openSessionStore(":memory:");
  await runTurn(
    store,
    new SessionBus(),
    OWNER,
    async () => ({
      message: "Here you go.",
      action: {
        type: "sign_and_send",
        chainId: 1,
        tx,
        verify: { recipient: OWNER, verdict: "ok" },
      },
    }),
    guard,
  );
  const es = store.all(OWNER);
  const p = es.find((e) => e.kind === "action_proposed");
  const action = p
    ? ((p.data as { action: ProposedAction }).action as Extract<
        ProposedAction,
        { type: "sign_and_send" }
      >)
    : null;
  const texts = es
    .filter((e) => e.kind === "agent_message")
    .map((e) => (e.data as { text: string }).text);
  return { action, texts };
}

beforeEach(() => {
  rpc.simulateCalls = [];
  rpc.logs = [];
  rpc.status = "0x1";
  rpc.code = { [USDC]: "0x6080", [WETH]: "0x6080" };
});

describe("real guard path: safe proposals are NOT refused", () => {
  it("passes the connected wallet as `from`, so verify_tx actually simulates", async () => {
    rpc.logs = [xfer(NATIVE_LOG, OWNER, OWNER, 10n ** 15n)];
    await turn({ to: OWNER, value: "1000000000000000" });
    expect(rpc.simulateCalls).toHaveLength(1);
    expect(rpc.simulateCalls[0]!.from).toBe(OWNER);
  });
  it("native ETH to self -> proposed, ok", async () => {
    rpc.logs = [xfer(NATIVE_LOG, OWNER, OWNER, 10n ** 15n)];
    const r = await turn({ to: OWNER, value: "1000000000000000" });
    expect(r.action?.verify.verdict).toBe("ok");
    expect(r.action?.verify.recipient).toBe(OWNER);
  });
  it("USDC transfer to self -> proposed (not refused)", async () => {
    rpc.logs = [xfer(USDC, OWNER, OWNER, 10n ** 6n)];
    const r = await turn({
      to: USDC,
      data: encodeFunctionData({ abi, functionName: "transfer", args: [OWNER, 10n ** 6n] }),
    });
    expect(r.action).not.toBeNull();
    expect(r.action?.verify.verdict).toBe("ok");
    expect(r.action?.verify.recipient.toLowerCase()).toBe(OWNER);
  });
  it("WETH wrap (deposit) -> proposed (not refused)", async () => {
    rpc.logs = [
      xfer(NATIVE_LOG, OWNER, WETH, 10n ** 16n),
      { address: WETH, topics: [DEPOSIT, t(OWNER)], data: toHex(10n ** 16n, { size: 32 }) },
    ];
    const r = await turn({
      to: WETH,
      value: "10000000000000000",
      data: encodeFunctionData({ abi, functionName: "deposit" }),
    });
    expect(r.action).not.toBeNull();
    expect(["ok", "warn"]).toContain(r.action?.verify.verdict);
    expect(rpc.simulateCalls[0]!.from).toBe(OWNER);
  });
});

// Warn, don't refuse: a dangerous tx is PROPOSED with the real "danger" verdict (shown to the user,
// ack-gated in the UI, never auto-sent) rather than silently dropped — the user is the final
// authority. The invariant is that it is never shown as "ok" and the model's text can't claim safety.
describe("real guard path: dangerous txs are proposed as danger, never ok", () => {
  it("approve(attacker, MAX) -> proposed danger, HIGH RISK text", async () => {
    const r = await turn({
      to: USDC,
      data: encodeFunctionData({ abi, functionName: "approve", args: [ATTACKER, maxUint256] }),
    });
    expect(r.action?.verify.verdict).toBe("danger");
    expect(r.texts[0]).toMatch(/HIGH RISK/);
  });
  it("USDC transfer to attacker -> proposed danger", async () => {
    rpc.logs = [xfer(USDC, OWNER, ATTACKER, 10n ** 6n)];
    const r = await turn({
      to: USDC,
      data: encodeFunctionData({ abi, functionName: "transfer", args: [ATTACKER, 10n ** 6n] }),
    });
    expect(r.action?.verify.verdict).toBe("danger");
  });
  it("native ETH to attacker -> never ok (nothing reaches the wallet)", async () => {
    rpc.logs = [xfer(NATIVE_LOG, OWNER, ATTACKER, 10n ** 15n)];
    const r = await turn({ to: ATTACKER, value: "1000000000000000" });
    expect(r.action?.verify.verdict ?? "refused").not.toBe("ok");
  });
  it("a reverting simulation -> proposed danger, never ok", async () => {
    rpc.status = "0x0";
    const r = await turn({ to: OWNER, value: "1" });
    expect(r.action?.verify.verdict ?? "refused").not.toBe("ok");
  });
  it("WETH event topics are the real keccak hashes", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./txtools.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain(DEPOSIT);
    expect(src).toContain(keccak256(toHex("Withdrawal(address,uint256)")));
  });
});
