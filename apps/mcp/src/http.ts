import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { SwapChanApi } from "./api.js";
import { extractKey, isValidKey, RateLimiter } from "./auth.js";
import { withClientIp } from "./clientctx.js";
import type { Config } from "./config.js";
import { createSwapChanServer, SERVER_NAME, SERVER_VERSION } from "./tools.js";

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

/** Streamable HTTP MCP endpoint at /mcp with API-key auth and per-key rate limiting. */
export function createHttpServer(
  api: SwapChanApi,
  cfg: Config,
  limiter = new RateLimiter(cfg.rateLimitPerMinute),
) {
  const handler = createMcpHandler(() => createSwapChanServer(api, cfg));
  const node = toNodeHandler(handler);

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/health")
      return json(res, 200, { ok: true, name: SERVER_NAME, version: SERVER_VERSION });
    if (path !== "/mcp") return json(res, 404, { error: "not found; MCP endpoint is /mcp" });

    const key = extractKey(req.headers);
    let clientId: string;
    if (key && isValidKey(key, cfg.mcpApiKeys)) clientId = `key:${key.slice(0, 6)}`;
    else if (!key && cfg.allowAnonymous) clientId = `anon:${req.socket.remoteAddress ?? "?"}`;
    else
      return json(
        res,
        401,
        {
          error: key
            ? "invalid API key"
            : "missing API key: send `x-api-key: <key>` or `Authorization: Bearer <key>`",
        },
        { "www-authenticate": 'Bearer realm="swapchan-mcp"' },
      );

    const wait = limiter.take(clientId);
    if (wait > 0)
      return json(
        res,
        429,
        { error: `rate limit exceeded (${cfg.rateLimitPerMinute}/min); retry in ${wait}s` },
        { "retry-after": String(wait) },
      );

    (req as IncomingMessage & { auth?: unknown }).auth = {
      token: key ?? "",
      clientId,
      scopes: ["swap:quote"],
    };
    const cf = req.headers["cf-connecting-ip"];
    const clientIp = (Array.isArray(cf) ? cf[0] : cf)?.trim() || undefined;
    withClientIp(clientIp, () => void node(req as Parameters<typeof node>[0], res));
  });

  return {
    server,
    close: async () => {
      await handler.close();
      server.close();
    },
  };
}
