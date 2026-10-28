import { randomUUID } from "node:crypto";
import { appendEvent, type SessionBus } from "./session-bus.js";
import { normalizeAddress, type SessionEvent, type SessionStore } from "./sessions.js";
import {
  type EvmTx,
  isActionable,
  type ModelAction,
  type ProposedAction,
  WalletRespond,
} from "./wallet-action.js";

/**
 * The server-side transaction guard. The model's own `verify` field is NOT trusted — a prompt-
 * injected agent could label a malicious approval "ok" and show the user's own address as the
 * recipient. The guard decodes the real calldata and simulates against chain state (SwapChan's
 * verify_tx), keyed to the connected wallet as the expected beneficiary, and returns an
 * independent verdict. `danger` means the tx is not safe to present for signing (unlimited /
 * unknown-spender approvals, funds not reaching the owner, etc.).
 */
export type GuardVerdict = { verdict: "ok" | "warn" | "danger"; recipient: string; note: string };
export type Guard = (chainId: number, tx: EvmTx, owner: string) => Promise<GuardVerdict>;

/**
 * The agent runner: context from the log → a `wallet_respond` envelope → events back on the log.
 *
 * The model call is injected (`Respond`) so the orchestration is testable without a live Anthropic
 * call; the real adapter (Agent SDK, scoped to the SwapChan MCP tools, enforcing the `wallet_respond`
 * tool) plugs in behind this interface. The agent's context is simply the full event log replayed —
 * a user message and a chain settlement are the same kind of thing to it.
 */

export interface AgentContext {
  address: string;
  events: SessionEvent[];
}
export type Respond = (ctx: AgentContext, onDelta?: (text: string) => void) => Promise<unknown>;

// Only these events start a turn. The agent's OWN output (agent_message/action_proposed) must not
// re-trigger it, or it would loop; wallet_result is informational and folds into the next turn.
const TRIGGER_KINDS = new Set<SessionEvent["kind"]>(["user_message", "settled"]);

/** One agent turn for an address. Fail-closed: a bad/blank envelope becomes a message, never an action. */
export async function runTurn(
  store: SessionStore,
  bus: SessionBus,
  address: string,
  respond: Respond,
  guard?: Guard,
): Promise<void> {
  let raw: unknown;
  try {
    // Stream the partial response text to the live channel (transient; not persisted). The final
    // agent_message below is the durable copy the UI replaces the streaming buffer with.
    raw = await respond({ address, events: store.all(address) }, (text) =>
      bus.publishDelta(address, text),
    );
  } catch (e) {
    appendEvent(store, bus, {
      address,
      kind: "agent_message",
      data: { text: "Something went wrong on my side. Please try again.", error: String(e) },
    });
    return;
  }

  const parsed = WalletRespond.safeParse(raw);
  if (!parsed.success) {
    appendEvent(store, bus, {
      address,
      kind: "agent_message",
      data: { text: "I could not produce a valid response. Please try again." },
    });
    return;
  }

  const { message, action } = parsed.data;

  // Server-side guard: the model's self-asserted verdict/recipient are NOT trusted. For a
  // sign_and_send, run the real on-chain guard (decode + simulate, keyed to the connected wallet)
  // and REPLACE the model's `verify` with the server's. We never block — the user is the final
  // authority and signs in their own wallet — so the point is to show the TRUE verdict and recipient
  // (a prompt-injected agent cannot fake "ok"), not to refuse a legitimate transaction. A high-risk
  // decode is surfaced as a strong warning, with the real severity in the note, but still goes
  // through for the user to decide.
  let outAction: ModelAction = action;
  if (action.type === "sign_and_send") {
    let v: GuardVerdict;
    try {
      v = guard
        ? await guard(action.chainId, action.tx, address)
        : { verdict: "warn", recipient: address, note: "unverified (server guard not configured)" };
    } catch (e) {
      v = {
        verdict: "warn",
        recipient: address,
        note: `could not verify on-chain (${String(e).slice(0, 120)})`,
      };
    }
    const note = v.verdict === "danger" ? `⚠ High risk — ${v.note}` : v.note;
    outAction = {
      ...action,
      verify: {
        recipient: v.recipient,
        minOut: action.verify.minOut,
        // Capped at "warn" so a legitimate-but-risky tx is never hard-blocked; the note carries the
        // real severity. The user confirms (or declines) in their own wallet.
        verdict: v.verdict === "danger" ? "warn" : v.verdict,
        note,
      },
    };
  }

  appendEvent(store, bus, { address, kind: "agent_message", data: { text: message } });
  if (isActionable(outAction)) {
    // The SERVER assigns the actionId — the sign-gate key. The model decides what; we own identity.
    const proposed: ProposedAction = { ...outAction, actionId: randomUUID() };
    appendEvent(store, bus, { address, kind: "action_proposed", data: { action: proposed } });
  }
}

/**
 * Wakes the agent on triggering events, one run at a time per address, coalescing: a wake during a
 * run re-runs once more against the latest log (so bursts and re-deliveries collapse to the newest
 * context instead of piling up). Mirrors paperclip's single-funnel wakeup + coalescing.
 */
export class AgentOrchestrator {
  private running = new Set<string>();
  private pending = new Set<string>();
  private inflight = new Map<string, Promise<void>>();
  private unsub: (() => void) | null = null;

  constructor(
    private store: SessionStore,
    private bus: SessionBus,
    private respond: Respond,
    private guard?: Guard,
  ) {}

  start(): this {
    this.unsub = this.bus.subscribeAll((e) => {
      if (TRIGGER_KINDS.has(e.kind)) this.wake(e.address);
    });
    return this;
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  wake(address: string): void {
    const addr = normalizeAddress(address);
    if (this.running.has(addr)) {
      this.pending.add(addr);
      return;
    }
    const p = this.run(addr);
    this.inflight.set(addr, p);
  }

  /** Resolves when the current run (and any coalesced re-run) for an address has finished. */
  idle(address: string): Promise<void> {
    return this.inflight.get(normalizeAddress(address)) ?? Promise.resolve();
  }

  private async run(addr: string): Promise<void> {
    this.running.add(addr);
    try {
      do {
        this.pending.delete(addr);
        await runTurn(this.store, this.bus, addr, this.respond, this.guard);
      } while (this.pending.has(addr));
    } finally {
      this.running.delete(addr);
      this.inflight.delete(addr);
    }
  }
}
