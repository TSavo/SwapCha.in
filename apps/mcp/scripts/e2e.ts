// Live smoke: MCP client -> running swapchan-mcp -> real apps/api. Usage: pnpm -F @swapchan/mcp e2e
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = process.env.MCP_URL ?? "http://127.0.0.1:8788/mcp";
const headers: Record<string, string> = process.env.MCP_KEY
  ? { "x-api-key": process.env.MCP_KEY }
  : {};
const c = new Client({ name: "e2e", version: "0" });
await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
const out = (r: unknown) =>
  JSON.parse((r as { content: { text: string }[] }).content[0]?.text ?? "null");

console.log("tools:", (await c.listTools()).tools.map((t) => t.name).join(", "));
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const LINK = "0x514910771af9ca656af840dff83e8264ecf986ca";
const q = out(
  await c.callTool({
    name: "get_quote",
    arguments: { fromChainId: 1, toChainId: 1, fromToken: USDC, toToken: LINK, amount: "100" },
  }),
);
console.log("get_quote:", JSON.stringify(q).slice(0, 400));
const r = out(
  await c.callTool({
    name: "compare_routes",
    arguments: {
      fromChainId: 1,
      toChainId: 8453,
      fromToken: USDC,
      toToken: USDC_BASE,
      amountBaseUnits: "100000000",
    },
  }),
);
console.log("compare_routes:", JSON.stringify(r).slice(0, 700));
await c.close();
