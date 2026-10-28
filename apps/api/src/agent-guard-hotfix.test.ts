import { encodeFunctionData, type Hex, maxUint256, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import {
  decodedRecipient,
  type Guard,
  REFUSE_SIGN_MESSAGE,
  REFUSE_UNVERIFIED,
  runTurn,
} from "./agent-runner.js";
import { SessionBus } from "./session-bus.js";
import { openSessionStore } from "./sessions.js";
import { calldataChecks, verdictOf } from "./txtools.js";
import type { ProposedAction } from "./wallet-action.js";

// The reviewer's attack list, run through SwapChan's real calldata checks (calldataChecks +
// verdictOf, the offline part of verify_tx) keyed to the connected wallet, so the verdicts are the
// guard's own, not hand-written.
const OWNER = "0x803b80fc7f3c67f9ace73750239c60dd764b2ce5";
const ATTACKER = "0x000000000000000000000000000000000000dead";
const TOKEN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const abi = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function setApprovalForAll(address operator, bool approved)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function multicall(bytes[] data)",
]);
const enc = (functionName: string, args: readonly unknown[]) =>
  encodeFunctionData({ abi, functionName, args } as never) as Hex;
const offlineGuard: Guard = async (_chainId, tx, owner) => {
  const { findings } = calldataChecks(
    { from: owner, to: tx.to, data: (tx.data ?? "0x") as Hex, value: BigInt(tx.value ?? "0") },
    { recipient: owner },
  );
  const verdict = verdictOf(findings);
  return { verdict, note: findings.map((f) => f.message).join(" ") };
};
const ZERO32 = `0x${"00".repeat(32)}` as Hex;

async function turn(
  tx: { to: string; data?: string; value?: string },
  guard: Guard = offlineGuard,
) {
  const store = openSessionStore(":memory:");
  const bus = new SessionBus();
  await runTurn(
    store,
    bus,
    OWNER,
    async () => ({
      message: "Totally safe, just sign it.",
      action: {
        type: "sign_and_send",
        chainId: 1,
        tx,
        verify: { recipient: OWNER, verdict: "ok" }, // the model lies
      },
    }),
    guard,
  );
  const es = store.all(OWNER);
  const proposed = es.find((e) => e.kind === "action_proposed");
  const action = proposed
    ? ((proposed.data as { action: ProposedAction }).action as Extract<
        ProposedAction,
        { type: "sign_and_send" }
      >)
    : null;
  const texts = es
    .filter((e) => e.kind === "agent_message")
    .map((e) => (e.data as { text: string }).text);
  return { es, action, texts };
}

// Warn, don't refuse: a danger verdict is PROPOSED (the user is the final authority and signs in
// their own wallet), but shown with the real "danger" verdict — never silently dropped, and the
// model's "Totally safe" lie is replaced by guard-derived HIGH RISK text. The UI requires an explicit
// acknowledgment before the Sign button enables, and auto-send never fires a danger action.
describe("danger is proposed as danger, with guard-authored HIGH RISK text", () => {
  it.each([
    ["approve(attacker, MAX)", { to: TOKEN, data: enc("approve", [ATTACKER, maxUint256]) }],
    [
      "setApprovalForAll(attacker, true)",
      { to: TOKEN, data: enc("setApprovalForAll", [ATTACKER, true]) },
    ],
    [
      "permit(owner, attacker, MAX)",
      { to: TOKEN, data: enc("permit", [OWNER, ATTACKER, maxUint256, 0n, 27, ZERO32, ZERO32]) },
    ],
    ["token transfer to attacker", { to: TOKEN, data: enc("transfer", [ATTACKER, 10n ** 6n]) }],
  ])("%s -> proposed with verdict danger, HIGH RISK text, not the model's lie", async (_n, tx) => {
    const r = await turn(tx);
    expect(r.action?.verify.verdict).toBe("danger");
    expect(r.texts).toHaveLength(1);
    expect(r.texts[0]).toMatch(/HIGH RISK/);
    expect(r.texts[0]).not.toContain("Totally safe");
  });
});

describe("warn is proposed as warn with the decoded recipient", () => {
  it("approve(attacker, small) -> warn, recipient = spender", async () => {
    const r = await turn({ to: TOKEN, data: enc("approve", [ATTACKER, 1000n]) });
    expect(r.action?.verify.verdict).toBe("warn");
    expect(r.action?.verify.recipient.toLowerCase()).toBe(ATTACKER);
  });
  it("transferFrom(owner, attacker) -> warn, recipient = to", async () => {
    const r = await turn({ to: TOKEN, data: enc("transferFrom", [OWNER, ATTACKER, 5n]) });
    expect(r.action?.verify.verdict).toBe("warn");
    expect(r.action?.verify.recipient.toLowerCase()).toBe(ATTACKER);
  });
  it("multicall-wrapped approval -> warn, recipient unknown (never the owner)", async () => {
    const inner = enc("approve", [ATTACKER, maxUint256]);
    const r = await turn({ to: TOKEN, data: enc("multicall", [[inner]]) });
    expect(r.action?.verify.verdict).toBe("warn");
    expect(r.action?.verify.recipient).toBe("unknown");
  });
  it("native transfer to attacker -> at least warn, real `to` shown", async () => {
    const r = await turn({ to: ATTACKER, value: "0xde0b6b3a7640000" });
    expect(r.action?.verify.verdict).toBe("warn");
    expect(r.action?.verify.recipient).toBe(ATTACKER);
  });
  it("native transfer to the owner stays ok", async () => {
    const r = await turn({ to: OWNER, value: "0x1" });
    expect(r.action?.verify.verdict).toBe("ok");
    expect(r.action?.verify.recipient).toBe(OWNER);
  });
  it("guard 'caution' is shown as warn; an unknown verdict is treated as danger (proposed)", async () => {
    const c = await turn({ to: OWNER }, async () => ({ verdict: "caution", note: "x" }));
    expect(c.action?.verify.verdict).toBe("warn");
    const u = await turn({ to: OWNER }, async () => ({ verdict: "weird", note: "x" }));
    expect(u.action?.verify.verdict).toBe("danger");
  });
});

describe("fail closed, no raw error text", () => {
  it("guard throws -> fixed refusal, no secret in any event", async () => {
    const r = await turn({ to: OWNER }, async () => {
      throw new Error("rpc down SECRET?key=abc");
    });
    expect(r.action).toBeNull();
    expect(r.texts).toEqual([REFUSE_UNVERIFIED]);
    expect(JSON.stringify(r.es)).not.toMatch(/SECRET|key=abc|rpc down/);
  });
  it("no guard configured -> refused", async () => {
    const store = openSessionStore(":memory:");
    await runTurn(store, new SessionBus(), OWNER, async () => ({
      message: "sign",
      action: {
        type: "sign_and_send",
        chainId: 1,
        tx: { to: OWNER },
        verify: { recipient: OWNER, verdict: "ok" },
      },
    }));
    expect(store.all(OWNER).map((e) => e.kind)).toEqual(["agent_message"]);
    expect((store.all(OWNER)[0]!.data as { text: string }).text).toBe(REFUSE_UNVERIFIED);
  });
  it("URLs in a guard note are scrubbed", async () => {
    const r = await turn({ to: OWNER }, async () => ({
      verdict: "danger",
      note: "Simulation reverts: https://rpc.example/v1/SECRETKEY",
    }));
    expect(JSON.stringify(r.es)).not.toContain("SECRETKEY");
  });
});

describe("sign_message", () => {
  it("an arbitrary model-proposed message is refused", async () => {
    const store = openSessionStore(":memory:");
    await runTurn(
      store,
      new SessionBus(),
      OWNER,
      async () => ({
        message: "Sign this to continue",
        action: { type: "sign_message", message: "Permit: give 0xdead all" },
      }),
      offlineGuard,
    );
    expect(store.all(OWNER).map((e) => e.kind)).toEqual(["agent_message"]);
    expect((store.all(OWNER)[0]!.data as { text: string }).text).toBe(REFUSE_SIGN_MESSAGE);
  });
});

describe("decodedRecipient", () => {
  it("unknown selector is 'unknown', never the owner", () => {
    expect(decodedRecipient({ to: TOKEN, data: "0x12345678" })).toBe("unknown");
  });
});
