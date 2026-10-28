import { describe, expect, it } from "vitest";
import { openSessionStore } from "./sessions.js";

const A = "0x803b80fC7f3C67f9aCE73750239C60dd764B2ce5";
const B = "0x1111111111111111111111111111111111111111";

describe("session event log", () => {
  it("appends in monotonic order and reads the full log per address", () => {
    const s = openSessionStore(":memory:");
    const e1 = s.append({ address: A, kind: "user_message", data: { text: "hi" } });
    const e2 = s.append({ address: A, kind: "agent_message", data: { text: "hello" } });
    expect(e2.id).toBeGreaterThan(e1.id);
    const log = s.all(A);
    expect(log.map((e) => e.kind)).toEqual(["user_message", "agent_message"]);
    expect(log[0].data).toEqual({ text: "hi" });
    s.close();
  });

  it("since(cursor) returns only events after the cursor (reconnect resync)", () => {
    const s = openSessionStore(":memory:");
    const e1 = s.append({ address: A, kind: "user_message", data: { text: "1" } });
    const e2 = s.append({ address: A, kind: "user_message", data: { text: "2" } });
    expect(s.since(A, e1.id).map((e) => e.id)).toEqual([e2.id]);
    expect(s.since(A, 0).length).toBe(2);
    expect(s.since(A, e2.id)).toEqual([]);
    expect(s.latestCursor(A)).toBe(e2.id);
    s.close();
  });

  it("append is idempotent per (address, idempotencyKey): a re-delivered event is a no-op", () => {
    const s = openSessionStore(":memory:");
    const hash = "0xdead";
    const first = s.append({
      address: A,
      kind: "settled",
      data: { action_id: "act-1", hash, received: "311.4 USDC" },
      idempotencyKey: hash,
    });
    const retry = s.append({
      address: A,
      kind: "settled",
      data: { action_id: "act-1", hash, received: "DIFFERENT" },
      idempotencyKey: hash,
    });
    expect(retry.id).toBe(first.id); // same original event
    expect(retry.data).toEqual(first.data); // the retry's payload did NOT overwrite
    expect(s.all(A).length).toBe(1); // only one row — no double-append
    s.close();
  });

  it("un-keyed events are never deduped (NULL idempotency keys are distinct)", () => {
    const s = openSessionStore(":memory:");
    s.append({ address: A, kind: "user_message", data: { text: "same" } });
    s.append({ address: A, kind: "user_message", data: { text: "same" } });
    expect(s.all(A).length).toBe(2);
    s.close();
  });

  it("the same idempotencyKey on a different address is a different log", () => {
    const s = openSessionStore(":memory:");
    s.append({ address: A, kind: "settled", data: { hash: "0x1" }, idempotencyKey: "0x1" });
    const onB = s.append({
      address: B,
      kind: "settled",
      data: { hash: "0x1" },
      idempotencyKey: "0x1",
    });
    expect(s.all(A).length).toBe(1);
    expect(s.all(B).length).toBe(1);
    expect(onB.address).toBe(B.toLowerCase());
    expect(s.since(A, 0).every((e) => e.address === A.toLowerCase())).toBe(true);
    s.close();
  });
});
