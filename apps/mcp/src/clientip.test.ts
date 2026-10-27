import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SwapChanApi } from "./api.js";
import { loadConfig } from "./config.js";
import { anonClientAddress, createHttpServer } from "./http.js";
import { startMockApi } from "./mockApi.js";

const KEY = "ip-test-key";
const SECRET = "test-internal-secret";
let mock: Awaited<ReturnType<typeof startMockApi>>;
beforeAll(async () => {
  mock = await startMockApi();
});
afterAll(() => {
  mock.server.close();
});

/** MCP server whose API client records the headers it sends to the API. */
async function start(internalKey?: string) {
  const seen: Record<string, string>[] = [];
  const cfg = loadConfig({
    SWAPCHAN_API_URL: mock.url,
    MCP_API_KEYS: KEY,
    MCP_RATE_LIMIT_PER_MIN: "1000",
    ...(internalKey ? { SWAPCHAN_INTERNAL_KEY: internalKey } : {}),
  });
  const api = new SwapChanApi(cfg.apiUrl, {
    internalKey: cfg.internalKey,
    fetch: ((u: string, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      return fetch(u, init);
    }) as typeof fetch,
  });
  const s = createHttpServer(api, cfg);
  await new Promise<void>((r) => s.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}/mcp`;
  const call = async (cfIp?: string) => {
    const c = new Client({ name: "t", version: "0" });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: { "x-api-key": KEY, ...(cfIp ? { "cf-connecting-ip": cfIp } : {}) },
        },
      }),
    );
    const before = seen.length;
    await c.callTool({ name: "get_supported_chains", arguments: {} });
    await c.close();
    return seen.slice(before);
  };
  return { s, call };
}

describe("MCP forwards the caller IP to the API", () => {
  it("two callers with different cf-connecting-ip are forwarded separately, with the internal key", async () => {
    const { s, call } = await start(SECRET);
    const a = await call("198.51.100.1");
    const b = await call("203.0.113.9");
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((h) => h["x-swapchan-client-ip"] === "198.51.100.1")).toBe(true);
    expect(b.every((h) => h["x-swapchan-client-ip"] === "203.0.113.9")).toBe(true);
    expect(a[0]?.["x-swapchan-internal-key"]).toBe(SECRET);
    await s.close();
  });

  it("no SWAPCHAN_INTERNAL_KEY: nothing is forwarded (old behavior)", async () => {
    const { s, call } = await start();
    const a = await call("198.51.100.1");
    expect(a.length).toBeGreaterThan(0);
    for (const h of a) {
      expect(h["x-swapchan-client-ip"]).toBeUndefined();
      expect(h["x-swapchan-internal-key"]).toBeUndefined();
    }
    await s.close();
  });

  it("no cf-connecting-ip on the MCP request: nothing is forwarded", async () => {
    const { s, call } = await start(SECRET);
    for (const h of await call()) expect(h["x-swapchan-client-ip"]).toBeUndefined();
    await s.close();
  });
});

describe("anonymous MCP rate-limit address", () => {
  const req = (headers: Record<string, string | string[]>, remoteAddress = "172.18.0.5") =>
    ({ headers, socket: { remoteAddress } }) as never;
  it("uses cf-connecting-ip when present, not the tunnel address", () => {
    expect(anonClientAddress(req({ "cf-connecting-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(anonClientAddress(req({ "cf-connecting-ip": ["203.0.113.8"] }))).toBe("203.0.113.8");
  });
  it("falls back to the socket address; ignores x-forwarded-for", () => {
    expect(anonClientAddress(req({ "x-forwarded-for": "9.9.9.9" }))).toBe("172.18.0.5");
    expect(anonClientAddress(req({}, ""))).toBe("?");
  });
});
