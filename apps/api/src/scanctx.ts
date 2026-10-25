import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";

/**
 * Scan lifetime + health.
 *
 * Root cause of the Oct 24 stall: find_money's per-stage/per-source deadlines were Promise.race()s, so a timed-out
 * source kept running (tens of thousands of eth_calls, giant multicall bodies, retries) after the response was sent.
 * Under concurrent load that abandoned work outgrew the CPU, the heap grew to the V8 limit (measured: 1 GB -> 6.7 GB
 * in 160 s, 350% CPU, sockets flat at ~10), and every new request starved until it hit its 17 s deadline.
 *
 * Fix: every scan runs inside a scope with an AbortSignal; the patched global fetch (and so viem's http transport)
 * joins that signal, so when a scan's hard deadline passes all its outstanding network work is cancelled. Scans are
 * also admitted through a small gate so load queues instead of piling up.
 */
const als = new AsyncLocalStorage<AbortSignal>();
export const scanSignal = () => als.getStore();

let installed = false;
/** Wrap globalThis.fetch once so every request made inside a scan scope is aborted with it. */
export function installScopedFetch() {
  if (installed) return;
  installed = true;
  const base = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const s = als.getStore();
    if (!s) return base(input, init);
    if (s.aborted) return Promise.reject(new Error("scan finished (request cancelled)"));
    const signal = init?.signal ? AbortSignal.any([init.signal, s]) : s;
    return base(input, { ...init, signal });
  }) as typeof fetch;
}

/** Run fn in a scope that is aborted after hardMs (or when the parent scope aborts), and always when fn settles + graceMs. */
export async function withScanScope<T>(hardMs: number, fn: () => Promise<T>, graceMs = 0): Promise<T> {
  const ac = new AbortController();
  const parent = als.getStore();
  const signal = parent ? AbortSignal.any([parent, ac.signal]) : ac.signal;
  const t = setTimeout(() => ac.abort(new Error("scan deadline")), hardMs);
  try {
    return await als.run(signal, fn);
  } finally {
    clearTimeout(t);
    if (graceMs > 0) setTimeout(() => ac.abort(new Error("scan finished")), graceMs).unref();
    else ac.abort(new Error("scan finished"));
  }
}

/** Counting gate: at most `max` holders; waiters time out after waitMs. */
export function gate(max: number, waitMs: number) {
  let active = 0;
  const q: (() => void)[] = [];
  const stats = () => ({ active, queued: q.length, max });
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((res, rej) => {
        const w = () => (clearTimeout(t), res());
        const t = setTimeout(() => {
          const i = q.indexOf(w);
          if (i >= 0) q.splice(i, 1);
          rej(new BusyError(`busy: ${active} scans running, ${q.length} queued; retry in a few seconds`));
        }, waitMs);
        q.push(w);
      });
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      q.shift()?.();
    }
  }
  return { run, stats };
}
export class BusyError extends Error {}

// ---------- health ----------
const lag = monitorEventLoopDelay({ resolution: 50 });
lag.enable();
type Scan = { at: number; ms: number; checks: number; timeouts: number };
const recent: Scan[] = [];
export function recordScan(s: Omit<Scan, "at">) {
  recent.push({ ...s, at: Date.now() });
  if (recent.length > 50) recent.shift();
  const r = s.checks ? s.timeouts / s.checks : 0;
  if (r >= 0.5) console.log(JSON.stringify({ evt: "find_money_watchdog", timeouts: s.timeouts, checks: s.checks, ms: s.ms }));
}
export function health(now = Date.now()) {
  const win = recent.filter((s) => now - s.at < 10 * 60_000);
  const last = win.slice(-5);
  const massTimeouts = last.length >= 5 && last.every((s) => s.checks > 0 && s.timeouts / s.checks >= 0.5);
  const h = getHeapStatistics();
  const heapPct = Math.round((100 * h.used_heap_size) / h.heap_size_limit);
  const lagMs = Math.round(lag.percentile(99) / 1e6);
  lag.reset();
  const reasons = [
    ...(massTimeouts ? ["last 5 scans: >=50% of sources timed out"] : []),
    ...(heapPct >= 85 ? [`heap ${heapPct}% of limit`] : []),
    ...(lagMs >= 2000 ? [`event-loop p99 lag ${lagMs} ms`] : []),
  ];
  return { ok: reasons.length === 0, reasons, heapPct, lagMs, scans10m: win.length, lastScans: last.map((s) => ({ ms: s.ms, timeouts: s.timeouts, checks: s.checks })) };
}

/** Exit (so `restart: unless-stopped` brings up a clean process) when unhealthy for `failsToExit` checks in a row. */
export function startWatchdog(everyMs = 30_000, failsToExit = 4) {
  let bad = 0;
  setInterval(() => {
    const h = health();
    bad = h.ok ? 0 : bad + 1;
    if (!h.ok) console.log(JSON.stringify({ evt: "health_watchdog", bad, ...h }));
    if (bad >= failsToExit) {
      console.log(JSON.stringify({ evt: "health_watchdog_exit", reasons: h.reasons }));
      process.exit(1);
    }
  }, everyMs).unref();
}
