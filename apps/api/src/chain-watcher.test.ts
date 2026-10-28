import { describe, expect, it } from "vitest";
import { ChainWatcher, type Settlement, type Track } from "./chain-watcher.js";
import { appendEvent, SessionBus } from "./session-bus.js";
import { openSessionStore, type SessionEvent } from "./sessions.js";

const A = "0x803b80fC7f3C67f9aCE73750239C60dd764B2ce5";
const HASH = "0xabc123";
const immediate = () => Promise.resolve();

function setup(track: Track) {
  const store = openSessionStore(":memory:");
  const bus = new SessionBus();
  const watcher = new ChainWatcher(store, bus, track, { sleep: immediate, intervalMs: 0 });
  return { store, bus, watcher };
}
const kinds = (es: SessionEvent[]) => es.map((e) => e.kind);
const settledEvent = (store: ReturnType<typeof openSessionStore>) =>
  store.all(A).find((e) => e.kind === "settled");

describe("ChainWatcher", () => {
  it("polls to done and appends a settled event with a 'do the next step' prompt", async () => {
    const track: Track = async () => ({
      status: "done",
      receivingTxHash: "0xdef",
      note: "got 311 USDC",
    });
    const { store, bus, watcher } = setup(track);
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a1", status: "sent", hash: HASH },
    });
    await watcher.idle(A, HASH);
    const s = settledEvent(store);
    expect(s).toBeTruthy();
    const d = s!.data as { status: string; hash: string; text: string; receivingTxHash: string };
    expect(d.status).toBe("done");
    expect(d.text).toContain(HASH);
    expect(d.text.toLowerCase()).toContain("do the next step");
    expect(d.receivingTxHash).toBe("0xdef");
  });

  it("keeps polling while pending, settles when it turns done", async () => {
    let n = 0;
    const track: Track = async () => (++n < 3 ? null : ({ status: "done" } as Settlement));
    const { store, bus, watcher } = setup(track);
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a1", status: "sent", hash: HASH },
    });
    await watcher.idle(A, HASH);
    expect(n).toBe(3);
    expect(settledEvent(store)?.data).toMatchObject({ status: "done" });
  });

  it("settles a wallet cancel as declined (re-wakes the agent) without tracking", async () => {
    let called = 0;
    const track: Track = async () => {
      called++;
      return { status: "done" };
    };
    const { store, bus, watcher } = setup(track);
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a1", status: "rejected" },
    });
    await watcher.idle(A, HASH);
    expect(called).toBe(0); // nothing to track for a cancel
    const d = settledEvent(store)!.data as { status: string; display: string; action_id: string };
    expect(d.status).toBe("failed");
    expect(d.action_id).toBe("a1"); // keyed by actionId (no hash)
    expect(d.display.toLowerCase()).toContain("declined");
  });

  it("ignores an intermediate 'sent' result that has no hash", async () => {
    let called = 0;
    const track: Track = async () => {
      called++;
      return { status: "done" };
    };
    const { store, bus, watcher } = setup(track);
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a2", status: "sent" },
    });
    await watcher.idle(A, HASH);
    expect(called).toBe(0);
    expect(settledEvent(store)).toBeUndefined();
  });

  it("settles a hash-less switch_chain as done (re-wakes the agent)", async () => {
    const { store, bus, watcher } = setup(async () => null);
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "sw1", status: "switched", chainId: 137 },
    });
    await watcher.idle(A, HASH);
    const d = settledEvent(store)!.data as { status: string; text: string; display: string };
    expect(d.status).toBe("done");
    expect(d.text.toLowerCase()).toContain("do the next step");
    expect(d.display.toLowerCase()).toContain("switched");
  });

  it("is idempotent: a re-delivered wallet_result does not double-settle", async () => {
    const track: Track = async () => ({ status: "done" });
    const { store, bus, watcher } = setup(track);
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a1", status: "sent", hash: HASH },
    });
    await watcher.idle(A, HASH);
    // Re-deliver the same result (reconnect/at-least-once): watcher sees an existing settlement, skips.
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a1", status: "sent", hash: HASH },
    });
    await watcher.idle(A, HASH);
    const settles = store.all(A).filter((e) => e.kind === "settled");
    expect(settles.length).toBe(1);
  });

  it("appends a failed settlement on a failed tx", async () => {
    const track: Track = async () => ({ status: "failed", note: "reverted" });
    const { store, bus, watcher } = setup(track);
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a1", status: "sent", hash: HASH },
    });
    await watcher.idle(A, HASH);
    const d = settledEvent(store)!.data as { status: string; text: string };
    expect(d.status).toBe("failed");
    expect(d.text).toContain("did not complete");
  });

  it("fast-paths a client-confirmed receipt to a done settlement without polling", async () => {
    let called = 0;
    const track: Track = async () => {
      called++;
      return null;
    };
    const { store, bus, watcher } = setup(track);
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a1", status: "confirmed", hash: HASH },
    });
    await watcher.idle(A, HASH);
    expect(called).toBe(0); // no polling — the browser already saw the receipt
    const d = settledEvent(store)!.data as { status: string; text: string };
    expect(d.status).toBe("done");
    expect(d.text.toLowerCase()).toContain("do the next step");
  });

  it("gives up after maxAttempts with a timeout settlement", async () => {
    const track: Track = async () => null; // never settles
    const store = openSessionStore(":memory:");
    const bus = new SessionBus();
    const watcher = new ChainWatcher(store, bus, track, {
      sleep: immediate,
      intervalMs: 0,
      maxAttempts: 3,
    });
    watcher.start();
    appendEvent(store, bus, {
      address: A,
      kind: "wallet_result",
      data: { action_id: "a1", status: "sent", hash: HASH },
    });
    await watcher.idle(A, HASH);
    const d = store.all(A).find((e) => e.kind === "settled")!.data as {
      status: string;
      text: string;
    };
    expect(d.status).toBe("failed");
    expect(d.text).toContain("timed out");
  });
});
