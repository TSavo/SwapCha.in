import { createHash, timingSafeEqual } from "node:crypto";

const h = (s: string) => createHash("sha256").update(s).digest();

/** Extract an API key from `x-api-key` or `Authorization: Bearer <key>`. */
export function extractKey(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const x = headers["x-api-key"];
  if (typeof x === "string" && x) return x.trim();
  const a = headers.authorization;
  if (typeof a === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(a);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

/** Constant-time membership check. */
export function isValidKey(key: string, keys: Set<string>): boolean {
  const hk = h(key);
  let ok = false;
  for (const k of keys) if (timingSafeEqual(hk, h(k))) ok = true;
  return ok;
}

/** Fixed-capacity token bucket per key: `perMinute` burst, refilled continuously. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 if allowed, else seconds to wait. */
  take(key: string): number {
    if (this.perMinute <= 0) return 0;
    const t = this.now();
    const rate = this.perMinute / 60_000;
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, at: t };
    b.tokens = Math.min(this.perMinute, b.tokens + (t - b.at) * rate);
    b.at = t;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.delete(this.buckets.keys().next().value as string);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / rate / 1000);
  }
}
