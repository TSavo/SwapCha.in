import { afterEach, describe, expect, it } from "vitest";
import { broadcastClientKey, broadcastLimiter } from "./broadcastmore.js";
import { forwardedClientIp } from "./clientip.js";
import { clientIpOf } from "./fresh.js";

const SECRET = "test-internal-secret";
const hdr = (h: Record<string, string>) => (n: string) => h[n.toLowerCase()];
const fromMcp = (ip: string, key = SECRET) =>
  hdr({ "x-swapchan-client-ip": ip, "x-swapchan-internal-key": key });

const prev = process.env.SWAPCHAN_INTERNAL_KEY;
afterEach(() => {
  if (prev === undefined) delete process.env.SWAPCHAN_INTERNAL_KEY;
  else process.env.SWAPCHAN_INTERNAL_KEY = prev;
});

describe("forwarded client IP from the MCP server", () => {
  it("honored only with the correct internal key", () => {
    expect(forwardedClientIp(fromMcp("198.51.100.1"), SECRET)).toBe("198.51.100.1");
    expect(forwardedClientIp(fromMcp("198.51.100.1", "wrong"), SECRET)).toBeUndefined();
    expect(forwardedClientIp(fromMcp("198.51.100.1", `${SECRET}x`), SECRET)).toBeUndefined();
    expect(forwardedClientIp(hdr({ "x-swapchan-client-ip": "1.2.3.4" }), SECRET)).toBeUndefined();
  });

  it("ignored when SWAPCHAN_INTERNAL_KEY is unset or empty, even if the caller sends a matching-looking key", () => {
    expect(forwardedClientIp(fromMcp("198.51.100.1", ""), undefined)).toBeUndefined();
    expect(forwardedClientIp(fromMcp("198.51.100.1", ""), "")).toBeUndefined();
    delete process.env.SWAPCHAN_INTERNAL_KEY;
    expect(forwardedClientIp(fromMcp("198.51.100.1"))).toBeUndefined();
  });

  it("broadcast key: public caller via Cloudflare sending the header keeps its own cf-connecting-ip", () => {
    process.env.SWAPCHAN_INTERNAL_KEY = SECRET;
    const pub = hdr({ "cf-connecting-ip": "192.0.2.7", "x-swapchan-client-ip": "10.9.9.9" });
    expect(broadcastClientKey(pub, "172.18.0.5")).toBe("192.0.2.7");
    const pubGuess = hdr({
      "cf-connecting-ip": "192.0.2.7",
      "x-swapchan-client-ip": "10.9.9.9",
      "x-swapchan-internal-key": "guess",
    });
    expect(broadcastClientKey(pubGuess, "172.18.0.5")).toBe("192.0.2.7");
  });

  it("no secret set: MCP calls fall back to the socket address as before", () => {
    delete process.env.SWAPCHAN_INTERNAL_KEY;
    expect(broadcastClientKey(fromMcp("198.51.100.1"), "172.18.0.5")).toBe("172.18.0.5");
    expect(clientIpOf(fromMcp("198.51.100.1"))).toBe("local");
  });

  it("two MCP callers get separate broadcast buckets; one caller is still limited", () => {
    process.env.SWAPCHAN_INTERNAL_KEY = SECRET;
    const lim = broadcastLimiter(1, () => 0);
    const a = broadcastClientKey(fromMcp("198.51.100.1"), "172.18.0.5");
    const b = broadcastClientKey(fromMcp("203.0.113.9"), "172.18.0.5");
    expect(lim(a).ok).toBe(true);
    expect(lim(b).ok).toBe(true);
    expect(lim(a).ok).toBe(false);
  });

  it("fresh/dev-tools key: forwarded IP wins only with the key; spoofed header ignored", () => {
    process.env.SWAPCHAN_INTERNAL_KEY = SECRET;
    expect(clientIpOf(fromMcp("198.51.100.1"))).toBe("198.51.100.1");
    expect(clientIpOf(fromMcp("198.51.100.1", "wrong"))).toBe("local");
    expect(
      clientIpOf(hdr({ "cf-connecting-ip": "192.0.2.7", "x-swapchan-client-ip": "10.9.9.9" })),
    ).toBe("192.0.2.7");
  });
});
