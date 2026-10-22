export const MCP_URL = "https://mcp.swapchan.com/mcp";
export const API_URL = "https://api.swapchan.com";
export const CURSOR_INSTALL =
  "cursor://anysphere.cursor-deeplink/mcp/install?name=swapchan&config=eyJ1cmwiOiAiaHR0cHM6Ly9tY3Auc3dhcGNoYW4uY29tL21jcCJ9";
export const VSCODE_INSTALL =
  "vscode:mcp/install?%7B%22name%22%3A%22swapchan%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A//mcp.swapchan.com/mcp%22%7D";

export const CONFIGS = {
  cursor: JSON.stringify({ mcpServers: { swapchan: { url: MCP_URL } } }, null, 2),
  vscode: JSON.stringify({ servers: { swapchan: { type: "http", url: MCP_URL } } }, null, 2),
  claudeDesktop: JSON.stringify(
    { mcpServers: { swapchan: { command: "npx", args: ["-y", "mcp-remote", MCP_URL] } } },
    null,
    2,
  ),
  claudeCode: `claude mcp add --transport http swapchan ${MCP_URL}`,
  chatgpt: MCP_URL,
  curl: `curl "${API_URL}/quotes?fromChainId=1&toChainId=8453&fromToken=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&toToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&amount=100000000&slippageBps=50"`,
} as const;

export const TOOLS = [
  ["get_supported_chains", "Every chain SwapChan routes on."],
  ["get_supported_tokens", "Token list per chain; any ERC-20 by address works too."],
  ["get_quote", "Best route across 0x, CoW, Velora, LI.FI, Across and Relay."],
  ["compare_routes", "All routes side by side: net USD, gas, fees, ETA."],
  ["build_swap_tx", "Unsigned transaction (or CoW order) for the user's wallet to sign."],
  ["get_route_status", "Track a swap or bridge until it lands."],
] as const;
