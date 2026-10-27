import { timingSafeEqual } from "node:crypto";

/** Header the MCP server uses to pass its caller's IP to the API on internal calls. */
export const FORWARDED_CLIENT_IP_HEADER = "x-swapchan-client-ip";
/** Header carrying the shared internal secret (env SWAPCHAN_INTERNAL_KEY) that proves the call came from the MCP server. */
export const INTERNAL_KEY_HEADER = "x-swapchan-internal-key";

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The caller IP forwarded by the MCP server, or undefined. Honored only when SWAPCHAN_INTERNAL_KEY is set (non-empty)
 * and the request carries the same value in x-swapchan-internal-key. Unset secret, missing or wrong key: the header is
 * ignored, so a public caller can never pick its own rate-limit bucket.
 */
export function forwardedClientIp(
  header: (name: string) => string | undefined,
  secret: string | undefined = process.env.SWAPCHAN_INTERNAL_KEY,
): string | undefined {
  if (!secret) return undefined;
  const key = header(INTERNAL_KEY_HEADER);
  if (!key || !sameSecret(key, secret)) return undefined;
  const ip = header(FORWARDED_CLIENT_IP_HEADER)?.trim();
  return ip && ip.length <= 64 ? ip : undefined;
}
