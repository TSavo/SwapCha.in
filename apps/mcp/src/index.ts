#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { SwapChanApi } from "./api.js";
import { loadConfig } from "./config.js";
import { createHttpServer } from "./http.js";
import { createSwapChanServer } from "./tools.js";

const cfg = loadConfig();
const api = new SwapChanApi(cfg.apiUrl, { apiKey: cfg.apiKey, internalKey: cfg.internalKey });

if (process.argv.includes("--stdio") || process.env.MCP_TRANSPORT === "stdio") {
  // Local, single-user: no API key/rate limit (the process boundary is the trust boundary). Logs go to stderr.
  serveStdio(() => createSwapChanServer(api, cfg));
  console.error(`swapchan-mcp (stdio) -> ${cfg.apiUrl}`);
} else {
  if (cfg.mcpApiKeys.size === 0 && !cfg.allowAnonymous)
    console.error(
      "warning: MCP_API_KEYS is empty and MCP_ALLOW_ANONYMOUS is off; every request will get 401",
    );
  const { server, close } = createHttpServer(api, cfg);
  server.listen(cfg.port, cfg.host, () =>
    console.error(`swapchan-mcp listening on http://${cfg.host}:${cfg.port}/mcp -> ${cfg.apiUrl}`),
  );
  for (const s of ["SIGINT", "SIGTERM"] as const)
    process.on(s, () => void close().then(() => process.exit(0)));
}
