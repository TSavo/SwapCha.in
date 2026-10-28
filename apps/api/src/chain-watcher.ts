import { appendEvent, type SessionBus } from "./session-bus.js";
import { normalizeAddress, type SessionEvent, type SessionStore } from "./sessions.js";
import type { ProposedAction } from "./wallet-action.js";

/**
 * The chain watcher: the third writer. When the user signs and broadcasts, the browser POSTs a
 * `wallet_result` carrying the tx hash. The watcher polls the chain until that tx is terminal, then
 * appends a `settled` event to the log — which, because `settled` is a trigger kind, re-wakes the
 * agent. To the agent the settlement is just the next line in the conversation: "transaction <hash>
 * just cleared — here's the txid, do the next step." That is how a dependent chain of swaps
 * continues: the agent sizes the next action on the ACTUAL settled result, not an estimate.
 *
 * Idempotent + fail-closed (paperclip's lesson): the `settled` event is keyed by tx hash, so a
 * re-delivered wallet_result, a reconnect, or a restart never appends a duplicate settlement and
 * never double-wakes. The actual on-chain lookup is INJECTED (`Track`) so this orchestration is
 * testable without a live chain; the real adapter (provider.status / SwapChan tx_status /
 * get_route_status) plugs in behind it.
 */

export interface TrackRequest {
  address: string;
  actionId: string;
  hash: string;
  /** Source chain of the signed tx, if the proposing action carried it. */
  chainId?: number;
  /** Route context the browser carries from the /build it signed (lets the tracker call provider.status). */
  provider?: string;
  fromChainId?: number;
  toChainId?: number;
  /** The action that was signed (verify context for the real tracker). */
  action?: ProposedAction;
}

export interface Settlement {
  status: "done" | "failed";
  /** The receiving-side tx hash for a cross-chain route, when the tracker knows it. */
  receivingTxHash?: string | null;
  /** Human/agent-readable note (e.g. the actual received amount). */
  note?: string;
}

/** Resolve a broadcast tx to its settlement. Return null/undefined while still pending (keep polling). */
export type Track = (req: TrackRequest) => Promise<Settlement | null | undefined>;

const DEFAULT_INTERVAL_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 225; // ~30 min at 8s; cross-chain routes can be slow

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface ChainWatcherOpts {
  intervalMs?: number;
  maxAttempts?: number;
  /** Injectable delay (tests pass an immediate resolve). */
  sleep?: Sleep;
}

export class ChainWatcher {
  private unsub: (() => void) | null = null;
  private inflight = new Map<string, Promise<void>>();
  private intervalMs: number;
  private maxAttempts: number;
  private sleep: Sleep;

  constructor(
    private store: SessionStore,
    private bus: SessionBus,
    private track: Track,
    opts: ChainWatcherOpts = {},
  ) {
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.sleep = opts.sleep ?? realSleep;
  }

  start(): this {
    this.unsub = this.bus.subscribeAll((e) => {
      if (e.kind === "wallet_result") this.onWalletResult(e);
    });
    return this;
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private onWalletResult(e: SessionEvent): void {
    const d = e.data as {
      action_id?: string;
      status?: string;
      hash?: string;
      chainId?: number;
      provider?: string;
      fromChainId?: number;
      toChainId?: number;
    };
    const status = String(d.status ?? "");
    const actionId = String(d.action_id ?? "");
    const hash = typeof d.hash === "string" ? d.hash : undefined;

    // Terminal result → settle at once (idempotent). This re-wakes the agent for the next step.
    // Keyed by hash when there is one; otherwise by actionId, so a hash-less outcome (switch_chain,
    // sign_message, or a wallet CANCEL) still produces a settlement and the agent continues/responds
    // instead of hanging.
    const done = status === "confirmed" || status === "signed" || status === "switched";
    const declined = status === "rejected";
    const failed = status === "failed" || status === "reverted" || declined;
    if (done || failed) {
      if (!this.alreadySettled(e.address, { hash, actionId })) {
        const note =
          status === "confirmed"
            ? "confirmed by wallet receipt"
            : status === "signed"
              ? "message signed"
              : status === "switched"
                ? "wallet switched network"
                : declined
                  ? "you declined it in your wallet"
                  : "reverted on-chain";
        this.settle(
          { address: e.address, actionId, hash },
          { status: done ? "done" : "failed", note },
        );
      }
      return;
    }

    // Intermediate 'sent'/'submitted' — poll the chain to settlement (cross-chain routes). Needs a hash.
    if (!hash) return;
    const req: TrackRequest = {
      address: e.address,
      actionId,
      hash,
      ...(typeof d.chainId === "number" ? { chainId: d.chainId } : {}),
      ...(typeof d.provider === "string" ? { provider: d.provider } : {}),
      ...(typeof d.fromChainId === "number" ? { fromChainId: d.fromChainId } : {}),
      ...(typeof d.toChainId === "number" ? { toChainId: d.toChainId } : {}),
      ...(this.findAction(e.address, String(d.action_id ?? "")) ?? {}),
    };
    this.watch(req);
  }

  /** Pull the proposed action (route/verify context) out of the log by its server actionId. */
  private findAction(address: string, actionId: string): { action: ProposedAction } | null {
    if (!actionId) return null;
    for (const e of this.store.all(address)) {
      if (e.kind === "action_proposed") {
        const a = (e.data as { action?: ProposedAction }).action;
        if (a && a.actionId === actionId) return { action: a };
      }
    }
    return null;
  }

  /** Begin (or no-op rejoin) polling a broadcast tx to settlement. Keyed by address|hash — idempotent. */
  watch(req: TrackRequest): void {
    const key = `${normalizeAddress(req.address)}|${req.hash.toLowerCase()}`;
    if (this.inflight.has(key)) return;
    // If a settlement for this hash already exists (restart/reconnect), do not re-poll.
    if (this.alreadySettled(req.address, { hash: req.hash, actionId: req.actionId })) return;
    const p = this.poll(req).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
  }

  /** Resolves when the poll for this tx has finished (settled or gave up) — for tests. */
  idle(address: string, hash: string): Promise<void> {
    return (
      this.inflight.get(`${normalizeAddress(address)}|${hash.toLowerCase()}`) ?? Promise.resolve()
    );
  }

  private alreadySettled(
    address: string,
    ref: { hash?: string | undefined; actionId: string },
  ): boolean {
    const h = ref.hash?.toLowerCase();
    return this.store.all(address).some((e) => {
      if (e.kind !== "settled") return false;
      const dd = e.data as { hash?: string; action_id?: string };
      return h ? String(dd.hash).toLowerCase() === h : String(dd.action_id) === ref.actionId;
    });
  }

  private async poll(req: TrackRequest): Promise<void> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let s: Settlement | null | undefined;
      try {
        s = await this.track(req);
      } catch {
        s = undefined; // transient tracker error → keep polling
      }
      if (s && (s.status === "done" || s.status === "failed")) {
        this.settle(req, s);
        return;
      }
      if (attempt < this.maxAttempts - 1) await this.sleep(this.intervalMs);
    }
    // Gave up: record an informational (non-terminal to the user) settlement so the agent can react.
    this.settle(req, { status: "failed", note: "tracking timed out; the tx may still settle" });
  }

  private settle(
    ref: { address: string; actionId: string; hash?: string | undefined },
    s: Settlement,
  ): void {
    const cleared = s.status === "done";
    const cap = (x: string) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
    const subject = ref.hash ? `Transaction ${ref.hash}` : null;

    // display: a clean, grammatical line for the chat bubble. text: display + the agent's cue.
    let display: string;
    if (cleared) {
      display = subject ? `${subject} confirmed.` : `${cap(s.note ?? "Done")}.`; // e.g. "Wallet switched network."
      if (s.receivingTxHash) display += ` Received as ${s.receivingTxHash}.`;
    } else {
      display = subject
        ? `${subject} did not complete — ${s.note ?? "it failed"}.`
        : `${cap(s.note ?? "That step did not complete")}.`; // e.g. "You declined it in your wallet."
    }
    const text = cleared ? `${display} Do the next step.` : display;

    appendEvent(this.store, this.bus, {
      address: ref.address,
      kind: "settled",
      // One settlement per action — key by tx hash if there is one, else by actionId (switch/sign).
      idempotencyKey: (ref.hash ?? ref.actionId).toLowerCase(),
      data: {
        action_id: ref.actionId,
        hash: ref.hash ?? null,
        status: s.status,
        receivingTxHash: s.receivingTxHash ?? null,
        display, // user-facing (chat bubble)
        text, // agent-facing (includes the "do the next step" cue)
      },
    });
  }
}
