export interface Config {
  apiUrl: string;
  apiKey: string | undefined;
  /** Shared secret with the API (SWAPCHAN_INTERNAL_KEY); unset = caller IPs are not forwarded. */
  internalKey: string | undefined;
  port: number;
  host: string;
  /** Allowed MCP API keys. Empty + allowAnonymous=false => every HTTP request is rejected. */
  mcpApiKeys: Set<string>;
  allowAnonymous: boolean;
  rateLimitPerMinute: number;
  maxSlippageBps: number;
  defaultSlippageBps: number;
  /** Optional JSON-RPC URLs per chain for build_swap_tx simulation, e.g. RPC_URL_1. */
  rpcUrls: Record<number, string>;
}

const int = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === "" ? Number.NaN : Number(v);
  return Number.isInteger(n) ? n : d;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rpcUrls: Record<number, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = /^RPC_URL_(\d+)$/.exec(k);
    if (m?.[1] && v) rpcUrls[Number(m[1])] = v;
  }
  const maxSlippageBps = Math.min(int(env.MCP_MAX_SLIPPAGE_BPS, 300), 5000);
  return {
    apiUrl: (env.SWAPCHAN_API_URL ?? env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(
      /\/$/,
      "",
    ),
    apiKey: env.SWAPCHAN_API_KEY || undefined,
    internalKey: env.SWAPCHAN_INTERNAL_KEY || undefined,
    port: int(env.MCP_PORT ?? env.PORT, 8788),
    host: env.MCP_HOST ?? "127.0.0.1",
    mcpApiKeys: new Set(
      (env.MCP_API_KEYS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    allowAnonymous: env.MCP_ALLOW_ANONYMOUS === "1" || env.MCP_ALLOW_ANONYMOUS === "true",
    rateLimitPerMinute: int(env.MCP_RATE_LIMIT_PER_MIN, 60),
    maxSlippageBps,
    defaultSlippageBps: Math.min(int(env.MCP_DEFAULT_SLIPPAGE_BPS, 50), maxSlippageBps),
    rpcUrls,
  };
}
