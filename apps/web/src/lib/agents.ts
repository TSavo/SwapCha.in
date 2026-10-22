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

export type Client = {
  id: string;
  name: string;
  detect: string;
  path: string;
  config: string;
  steps: string;
  deeplink?: string;
};

export const CLIENTS: Client[] = [
  {
    id: "cursor",
    name: "Cursor",
    detect: "you are Cursor's agent",
    path: "~/.cursor/mcp.json (global) or .cursor/mcp.json (project)",
    config: CONFIGS.cursor,
    steps:
      "Merge into mcpServers. Cursor picks it up automatically; if the tools don't appear, the user reloads the window or toggles swapchan in Settings → MCP.",
    deeplink: CURSOR_INSTALL,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    detect: "you are Claude Code (CLI)",
    path: "run in the shell",
    config: CONFIGS.claudeCode,
    steps:
      "Run it (add --scope user to make it global). The user restarts Claude Code; /mcp should list swapchan.",
  },
  {
    id: "claude",
    name: "Claude Desktop",
    detect: "you are Claude Desktop",
    path: "macOS ~/Library/Application Support/Claude/claude_desktop_config.json, Windows %APPDATA%\\Claude\\claude_desktop_config.json",
    config: CONFIGS.claudeDesktop,
    steps: `Merge into mcpServers (needs Node for npx). The user fully quits and reopens Claude Desktop. No file access? Tell the user: Settings → Connectors → Add custom connector, URL ${MCP_URL}.`,
  },
  {
    id: "vscode",
    name: "VS Code / Copilot",
    detect: "you are GitHub Copilot in VS Code",
    path: ".vscode/mcp.json (workspace) or the user mcp.json (command: MCP: Open User Configuration)",
    config: CONFIGS.vscode,
    steps:
      "Merge into servers. The user clicks Start on swapchan in the MCP view (or reloads), then enables its tools in agent mode.",
    deeplink: VSCODE_INSTALL,
  },
  {
    id: "codex",
    name: "Codex",
    detect: "you are OpenAI Codex CLI",
    path: "~/.codex/config.toml (or run: codex mcp add swapchan --url " + MCP_URL + ")",
    config: `[mcp_servers.swapchan]\nurl = "${MCP_URL}"`,
    steps:
      "Append the table if it isn't there. The user restarts Codex; /mcp should list swapchan.",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    detect: "you are Windsurf / Cascade",
    path: "~/.codeium/windsurf/mcp_config.json",
    config: JSON.stringify({ mcpServers: { swapchan: { serverUrl: MCP_URL } } }, null, 2),
    steps: "Merge into mcpServers. The user presses Refresh in Cascade's MCP panel.",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    detect: "you are Gemini CLI",
    path:
      "~/.gemini/settings.json (or run: gemini mcp add --transport http swapchan " + MCP_URL + ")",
    config: JSON.stringify({ mcpServers: { swapchan: { httpUrl: MCP_URL } } }, null, 2),
    steps: "Merge into mcpServers. The user restarts Gemini CLI; /mcp should list swapchan.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    detect: "you are ChatGPT",
    path: "ChatGPT can't install it itself: tell the user Settings → Connectors → Advanced → Developer mode → Create",
    config: CONFIGS.chatgpt,
    steps: "Name SwapChan, URL as above, no authentication. Then enable it in a new chat.",
  },
];

const HEAD = `Install the SwapChan MCP server for me and start using it. SwapChan finds the best-price route for same-chain and cross-chain crypto swaps across 0x, CoW, Velora, LI.FI, Across and Relay.

Server: ${MCP_URL} (Streamable HTTP, no API key). Tools: ${TOOLS.map((t) => t[0]).join(", ")}.`;

const RULES = `Rules for installing:
- Edit the config file yourself if you can. Read it first and MERGE the swapchan entry: never remove or overwrite other servers or settings. Create the file if it doesn't exist.
- If you can't edit files or run commands, give me the exact steps instead.
- Tell me clearly if I need to restart or reload anything, and what.`;

const VERIFY = `Verify: once the tools are available, call get_supported_chains, then get_quote for 100 USDC on Ethereum (chain 1, 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, amount 100000000) to USDC on Base (chain 8453, 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913). Report back: installed where, the best route, tokens received and the fee. If tools only appear after a restart, tell me to restart and to ask you to run this check.`;

const USAGE = `After that, use SwapChan whenever I ask to swap, bridge, or compare crypto prices or routes:
- get_quote for the best route, compare_routes to show alternatives; get_supported_tokens for addresses (any ERC-20 address works). Amounts are in base units.
- Show: tokens received, USD value, gas, ETA, provider, and SwapChan's fee (swapchanFeeUsd, 0.1%).
- Every SwapChan result has a `display` field: show it to me as markdown. It has the chain-chan images (![alt](imageUrl)), Swap-chan's line, and a swapUrl link that opens swapchan.com with the route prefilled.
- To execute, give me the swapUrl (https://swapchan.com prefilled) to swap with my own wallet, or use build_swap_tx for an unsigned transaction I sign myself. Never ask for private keys or seed phrases.
- After I send a transaction, track it with get_route_status until it lands.
Docs: https://swapchan.com/agents`;

const block = (c: Client) =>
  `### ${c.name} (${c.detect})\nWhere: ${c.path}\n${c.config}\n${c.steps}`;

export function clientPrompt(c: Client): string {
  return `${HEAD}\n\nYou are running in ${c.name}.\n\n${block(c)}\n\n${RULES}\n\n${VERIFY}\n\n${USAGE}`;
}

export const UNIVERSAL_PROMPT = `${HEAD}

Step 1: work out which client you are running in, then follow ONLY that section. Unknown client: find where it configures MCP servers and add a Streamable HTTP server named "swapchan" with URL ${MCP_URL}; if it only supports stdio, use: npx -y mcp-remote ${MCP_URL}

${CLIENTS.map(block).join("\n\n")}

${RULES}

${VERIFY}

${USAGE}`;
