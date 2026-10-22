import type { MiddlewareHandler } from "hono";

/** SWAPCHAN_API_KEYS="key:perMinute,key2:perMinute". Unset/empty = open dev mode. Fixed 60s window, in-memory. */
export function parseKeys(raw: string | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const part of (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [k, n] = part.split(":");
    if (k) m.set(k, Number(n) > 0 ? Number(n) : 60);
  }
  return m;
}

export function apiKeyAuth(keys: Map<string, number>, now = () => Date.now()): MiddlewareHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return async (c, next) => {
    if (keys.size === 0 || c.req.path === "/health" || c.req.method === "OPTIONS") return next();
    const key =
      c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const limit = key ? keys.get(key) : undefined;
    if (!key || limit === undefined) return c.json({ error: "missing or invalid API key" }, 401);
    const t = now();
    let w = windows.get(key);
    if (!w || t - w.start >= 60_000) {
      w = { start: t, count: 0 };
      windows.set(key, w);
    }
    w.count++;
    c.header("x-ratelimit-limit", String(limit));
    c.header("x-ratelimit-remaining", String(Math.max(0, limit - w.count)));
    if (w.count > limit) {
      c.header("retry-after", String(Math.ceil((w.start + 60_000 - t) / 1000)));
      return c.json({ error: "rate limit exceeded" }, 429);
    }
    return next();
  };
}
