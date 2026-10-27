import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request caller IP (from Cloudflare's cf-connecting-ip on the incoming MCP request). */
const store = new AsyncLocalStorage<{ clientIp: string | undefined }>();

export function withClientIp<T>(clientIp: string | undefined, fn: () => T): T {
  return store.run({ clientIp }, fn);
}

export const currentClientIp = (): string | undefined => store.getStore()?.clientIp;
