import { EventEmitter } from "node:events";
import type { EventKind, SessionEvent, SessionStore } from "./sessions.js";
import { normalizeAddress } from "./sessions.js";

/**
 * In-process notifier so an open SSE stream for an address wakes the instant a new event is
 * appended to that address's log. This is LIVENESS ONLY — the durable store is the source of
 * truth; a missed notification is harmless because a reconnecting client re-reads from its cursor
 * (resync, not lossless replay). Do not persist here; do not trust it for ordering or delivery.
 */
const ALL = "__all__";

export class SessionBus {
  private em = new EventEmitter();
  constructor() {
    this.em.setMaxListeners(0); // many concurrent SSE streams per process
  }
  publish(address: string, event: SessionEvent): void {
    this.em.emit(normalizeAddress(address), event); // per-address: SSE streams
    this.em.emit(ALL, event); // global: the agent orchestrator's wake trigger
  }
  /** Per-address subscription — one SSE stream per connected wallet. */
  subscribe(address: string, listener: (e: SessionEvent) => void): () => void {
    const key = normalizeAddress(address);
    this.em.on(key, listener);
    return () => this.em.off(key, listener);
  }
  /** Global subscription — the agent orchestrator listens for triggering events across all addresses. */
  subscribeAll(listener: (e: SessionEvent) => void): () => void {
    this.em.on(ALL, listener);
    return () => this.em.off(ALL, listener);
  }

  /**
   * Transient streaming text for an in-flight agent turn — NOT persisted, liveness only. The SSE
   * stream relays it so the UI types the response in as it's generated; the durable agent_message
   * event follows and is the source of truth. A missed delta is harmless (resync replays the final).
   */
  publishDelta(address: string, text: string): void {
    this.em.emit(`delta:${normalizeAddress(address)}`, text);
  }
  subscribeDelta(address: string, listener: (text: string) => void): () => void {
    const key = `delta:${normalizeAddress(address)}`;
    this.em.on(key, listener);
    return () => this.em.off(key, listener);
  }
}

/**
 * The one way every writer (chat route, agent runner, chain watcher) adds to a session: append to
 * the durable log, then notify live subscribers. Append is idempotent (see SessionStore.append),
 * so publishing the returned event is safe even when the append was a dedup no-op.
 */
export function appendEvent(
  store: SessionStore,
  bus: SessionBus,
  input: { address: string; kind: EventKind; data: unknown; idempotencyKey?: string | null },
): SessionEvent {
  const event = store.append(input);
  bus.publish(event.address, event);
  return event;
}
