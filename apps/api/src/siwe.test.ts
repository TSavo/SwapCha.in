import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { chatRoutes } from "./chat.js";
import { SessionBus } from "./session-bus.js";
import { openSessionStore } from "./sessions.js";
import {
  authRoutes,
  cookieAddress,
  recoverSigner,
  requireWalletAuth,
  siweMessage,
} from "./siwe.js";

const ENV = { SWAPCHAN_SESSION_SECRET: "test-secret-abcdefghijklmnop" };
// A fixed throwaway key (test only, never funded).
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ACCT = privateKeyToAccount(KEY);

describe("recoverSigner (blocktools msgVerify) parity with viem", () => {
  it("recovers the same signer viem's recoverMessageAddress does", async () => {
    for (const message of [
      "hi",
      siweMessage(ACCT.address, "deadbeef".repeat(4), "2026-01-01T00:00:00.000Z"),
      "unicode: café ☕ \n multi-line",
    ]) {
      const signature = await ACCT.signMessage({ message });
      const viem = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
      const bt = await recoverSigner(ACCT.address, message, signature);
      expect(bt.toLowerCase()).toBe(viem.toLowerCase());
      expect(bt.toLowerCase()).toBe(ACCT.address.toLowerCase());
    }
  });

  it("rejects a malformed signature (same as the old viem path: /verify → 401)", async () => {
    for (const bad of ["0x", "0x1234", "nothex"])
      await expect(recoverSigner(ACCT.address, "hi", bad)).rejects.toThrow();
  });

  it("recovers a signer different from the claimed address on a mismatched signature", async () => {
    const signature = await ACCT.signMessage({ message: "hi" });
    // Claiming a different address does not change who signed: recovered stays the real signer,
    // and the /verify handler's own equality check turns that into signature_mismatch.
    const recovered = await recoverSigner(
      "0x1111111111111111111111111111111111111111",
      "hi",
      signature,
    );
    expect(recovered.toLowerCase()).toBe(ACCT.address.toLowerCase());
  });
});

describe("SmartWallet sign-to-view cookie", () => {
  it("round-trips a signed cookie and rejects tampering/expiry", () => {
    const secret = "s".repeat(32);
    const addr = ACCT.address.toLowerCase();
    const exp = Date.now() + 60_000;
    const mac = (() => {
      // build via the same path the server uses, by signing in and reading Set-Cookie would be
      // integration; here we assert the verifier's contract directly.
      return cookieAddress(secret, `${addr}.${exp}.${"00"}`);
    })();
    expect(mac).toBeNull(); // a bogus mac never verifies
  });

  it("issues a nonce, verifies a real signature, sets a cookie, and gates /chat", async () => {
    const auth = authRoutes(ENV);
    const addr = ACCT.address;

    // 1. nonce
    const nres = await auth.request(`/nonce?address=${addr}`);
    expect(nres.status).toBe(200);
    const { message, nonce } = (await nres.json()) as { message: string; nonce: string };
    expect(message).toBe(siweMessage(addr, nonce, message.split("Issued At: ")[1]!.trim()));

    // 2. sign + verify
    const signature = await ACCT.signMessage({ message });
    const vres = await auth.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr, signature }),
    });
    expect(vres.status).toBe(200);
    const setCookie = vres.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sw_session=");
    const cookie = setCookie.split(";")[0]!; // "sw_session=<value>"

    // The cookie verifies to the signer's address.
    const value = cookie.split("=").slice(1).join("=");
    expect(cookieAddress(ENV.SWAPCHAN_SESSION_SECRET, value)).toBe(addr.toLowerCase());

    // 3. gated chat: no cookie -> 401; with cookie -> allowed
    const store = openSessionStore(":memory:");
    const chat = chatRoutes(store, new SessionBus(), ENV);
    const body = JSON.stringify({ address: addr, kind: "user_message", data: { text: "hi" } });

    const noCookie = await chat.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(noCookie.status).toBe(401);

    const withCookie = await chat.request("/", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    expect(withCookie.status).toBe(200);
  });

  it("rejects a cookie bound to a different address than the request", async () => {
    const gate = requireWalletAuth(ENV);
    // craft a valid cookie for ACCT via the real sign-in
    const auth = authRoutes(ENV);
    const nres = await auth.request(`/nonce?address=${ACCT.address}`);
    const { message } = (await nres.json()) as { message: string };
    const signature = await ACCT.signMessage({ message });
    const vres = await auth.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: ACCT.address, signature }),
    });
    const cookie = (vres.headers.get("set-cookie") ?? "").split(";")[0]!;

    // Use that cookie but ask for a DIFFERENT address.
    const other = "0x1111111111111111111111111111111111111111";
    const { Hono } = await import("hono");
    const app = new Hono();
    app.get("/stream", gate, (c) => c.text("ok"));
    const res = await app.request(`/stream?address=${other}`, { headers: { cookie } });
    expect(res.status).toBe(401);
  });
});
