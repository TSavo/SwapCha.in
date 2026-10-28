import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { recoverMessageAddress } from "viem";
import { z } from "zod";
import { normalizeAddress } from "./sessions.js";

/**
 * Sign-to-view gate for the SmartWallet channel.
 *
 * The event log is keyed by the connected address, so reading `/chat/stream` or posting to `/chat`
 * would otherwise hand anyone who types address X all of X's history and chat. That is a privacy
 * hole (funds are never at risk — proposals are unsigned and signing lives in the user's wallet —
 * but history is private). The gate: no session cookie for X → 401 with a nonce → the wallet signs
 * the nonce → the server recovers the signer and, if it is X, sets a signed httpOnly cookie bound to
 * X → every later request just works until the cookie expires. SIWE-style, EVM-only (the SmartWallet
 * connects EVM wallets via wagmi; personal_sign / EIP-191 recovery).
 *
 *   GET  /auth/nonce?address=0x..  → { address, nonce, message }   (message is what the wallet signs)
 *   POST /auth/verify {address, signature} → sets the cookie, 200 { ok, address }
 *   POST /auth/logout              → clears the cookie
 *
 * The cookie is `sw_session = <addr>.<expMs>.<hmac>`, hmac = HMAC-SHA256(secret, "<addr>.<expMs>").
 * httpOnly + SameSite=Lax keeps it same-site (swapchan.com ↔ api.swapchan.com) and unreadable by JS.
 */

const COOKIE = "sw_session";
const NONCE_TTL_MS = 10 * 60_000; // a nonce is good for 10 minutes
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // a signed session lasts a week
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Resolve the HMAC secret. In production it must be set; in dev we mint an ephemeral one so the
 *  server runs (sessions then reset on restart, which is fine for local work). */
export function sessionSecret(env: Record<string, string | undefined>): string {
  const s = env.SWAPCHAN_SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (env.NODE_ENV === "production")
    throw new Error("SWAPCHAN_SESSION_SECRET must be set (>=16 chars) in production");
  return `dev-ephemeral-${randomBytes(24).toString("hex")}`;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function makeCookieValue(secret: string, addr: string, expMs: number): string {
  const payload = `${addr}.${expMs}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** A `sw_session=<value>` Cookie header for `address` — what a successful sign-in sets. Exported for
 *  tests and internal callers; minting one still requires the server secret, so it grants nothing a
 *  `/verify` with a real signature would not. */
export function sessionCookieHeader(
  secret: string,
  address: string,
  ttlMs = SESSION_TTL_MS,
): string {
  return `${COOKIE}=${makeCookieValue(secret, address.trim().toLowerCase(), Date.now() + ttlMs)}`;
}

/** The address a valid, unexpired cookie is bound to, or null. */
export function cookieAddress(
  secret: string,
  raw: string | undefined,
  now = Date.now(),
): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i < 0) return null;
  const payload = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  const expected = sign(secret, payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const dot = payload.lastIndexOf(".");
  if (dot < 0) return null;
  const addr = payload.slice(0, dot);
  const expMs = Number(payload.slice(dot + 1));
  if (!Number.isFinite(expMs) || expMs < now) return null;
  return addr;
}

const cookieOpts = (env: Record<string, string | undefined>, maxAgeSec: number) => {
  const prod = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: prod,
    path: "/",
    maxAge: maxAgeSec,
    // In production the cookie is shared across swapchan.com + api.swapchan.com; in dev it is
    // host-only (localhost) so no Domain attribute.
    ...(prod && env.SWAPCHAN_COOKIE_DOMAIN ? { domain: env.SWAPCHAN_COOKIE_DOMAIN } : {}),
  };
};

/** Build the SIWE-style message the wallet signs. We control both ends, so it is plain and explicit. */
export function siweMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    "swapchan.com wants you to sign in with your Ethereum account:",
    address,
    "",
    "Sign to view your SmartWallet history. This is free and authorizes no transaction — it only proves you control this address.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

const VerifyBody = z.object({
  address: z.string().trim().regex(EVM_ADDR),
  signature: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]+$/),
});

export function authRoutes(env: Record<string, string | undefined>): Hono {
  const app = new Hono();
  const secret = sessionSecret(env);
  // One outstanding nonce per address; short TTL. In-memory is fine — a lost nonce just reprompts.
  const nonces = new Map<string, { message: string; exp: number }>();
  const sweep = () => {
    const t = Date.now();
    if (nonces.size > 10_000) for (const [k, v] of nonces) if (v.exp < t) nonces.delete(k);
  };

  app.get("/nonce", (c) => {
    const address = c.req.query("address")?.trim() ?? "";
    if (!EVM_ADDR.test(address)) return c.json({ error: "bad_address" }, 400);
    const key = normalizeAddress(address);
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date().toISOString();
    const message = siweMessage(address, nonce, issuedAt);
    sweep();
    nonces.set(key, { message, exp: Date.now() + NONCE_TTL_MS });
    return c.json({ address, nonce, message });
  });

  app.post("/verify", async (c) => {
    const parsed = VerifyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request" }, 400);
    const { address, signature } = parsed.data;
    const key = normalizeAddress(address);
    const pending = nonces.get(key);
    if (!pending || pending.exp < Date.now()) return c.json({ error: "no_nonce" }, 400);
    let recovered: string;
    try {
      recovered = await recoverMessageAddress({
        message: pending.message,
        signature: signature as `0x${string}`,
      });
    } catch {
      return c.json({ error: "bad_signature" }, 401);
    }
    if (normalizeAddress(recovered) !== key) return c.json({ error: "signature_mismatch" }, 401);
    nonces.delete(key); // single-use
    const expMs = Date.now() + SESSION_TTL_MS;
    setCookie(
      c,
      COOKIE,
      makeCookieValue(secret, key, expMs),
      cookieOpts(env, SESSION_TTL_MS / 1000),
    );
    return c.json({ ok: true, address: key, expiresAt: expMs });
  });

  app.post("/logout", (c) => {
    setCookie(c, COOKIE, "", cookieOpts(env, 0));
    return c.json({ ok: true });
  });

  return app;
}

/**
 * Gate middleware for the chat channel. The request's address (query for GET, body for POST — Hono
 * caches the parsed body so the handler re-reads it for free) must match the address the cookie is
 * bound to. No valid cookie, or a mismatch → 401 auth_required, which the UI turns into a sign prompt.
 */
export function requireWalletAuth(env: Record<string, string | undefined>): MiddlewareHandler {
  const secret = sessionSecret(env);
  return async (c, next) => {
    let reqAddr = c.req.query("address")?.trim();
    if (!reqAddr && (c.req.method === "POST" || c.req.method === "PUT")) {
      const body = (await c.req.json().catch(() => null)) as { address?: unknown } | null;
      if (body && typeof body.address === "string") reqAddr = body.address.trim();
    }
    if (!reqAddr) return c.json({ error: "address_required" }, 400);
    const bound = cookieAddress(secret, getCookie(c, COOKIE));
    if (!bound || bound !== normalizeAddress(reqAddr))
      return c.json({ error: "auth_required", address: reqAddr }, 401);
    return next();
  };
}
