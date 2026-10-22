// Test-only mock of the SwapChan HTTP API (packages/shared contract). Also runnable: `node src/mockApi.ts`.
import { createServer, type Server } from "node:http";
import { NATIVE_TOKEN, type Quote, SUPPORTED_CHAINS, tokenList } from "@swapchan/shared";

export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const ROUTER = "0x1111111254eeb25477b68fb85ed929f73a960582";

export function mockQuote(
  id: string,
  provider: string,
  q: URLSearchParams,
  toAmount: string,
  netUsd: number | null,
  withTx: boolean,
): Quote {
  const from = Number(q.get("fromChainId"));
  const to = Number(q.get("toChainId"));
  const fromToken = q.get("fromToken") as `0x${string}`;
  const toToken = q.get("toToken") as `0x${string}`;
  const amount = q.get("amount") ?? "0";
  return {
    id,
    provider,
    request: {
      fromChainId: from,
      toChainId: to,
      fromToken,
      toToken,
      amount,
      slippageBps: Number(q.get("slippageBps") ?? 50),
    },
    toAmount,
    toAmountMin: ((BigInt(toAmount) * 995n) / 1000n).toString(),
    gasUsd: 1.2,
    feeUsd: 0.3,
    netUsd,
    etaSeconds: from === to ? 15 : 120,
    steps: [
      {
        type: from === to ? "swap" : "bridge",
        tool: provider,
        fromChainId: from,
        toChainId: to,
        fromToken,
        toToken,
        fromAmount: amount,
        toAmount,
      },
    ],
    approvalAddress: fromToken.toLowerCase() === NATIVE_TOKEN.toLowerCase() ? null : ROUTER,
    tx:
      withTx && q.get("taker")
        ? { chainId: from, to: ROUTER, data: "0xdeadbeef", value: "0" }
        : null,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
}

export function startMockApi(port = 0): Promise<{ server: Server; url: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    calls.push(`${req.method} ${u.pathname}${u.search}`);
    const send = (s: number, b: unknown) => {
      res.writeHead(s, { "content-type": "application/json" });
      res.end(JSON.stringify(b));
    };
    const q = u.searchParams;
    switch (u.pathname) {
      case "/chains":
        return send(
          200,
          Object.entries(SUPPORTED_CHAINS).map(([id, c]) => ({ id: Number(id), ...c })),
        );
      case "/tokens": {
        const c = q.get("chainId");
        return send(200, c ? tokenList.filter((t) => t.chainId === Number(c)) : tokenList);
      }
      case "/quotes": {
        if (q.get("amount") === "999") return send(500, { error: "all providers down" });
        const cross = q.get("fromChainId") !== q.get("toChainId");
        const quotes = cross
          ? [
              mockQuote("q-across", "across", q, "990000", 0.98, true),
              mockQuote("q-lifi", "lifi", q, "985000", 0.97, false),
            ]
          : [
              mockQuote("q-0x", "0x", q, "2000000000", 1999.5, true),
              mockQuote("q-cow", "cow", q, "1999000000", 1998.4, false),
            ];
        return send(200, {
          quotes,
          best: quotes[0]?.id ?? null,
          errors: [{ provider: "relay", message: "timeout" }],
        });
      }
      case "/build": {
        let body = "";
        for await (const ch of req) body += ch;
        const { quoteId } = JSON.parse(body) as { quoteId: string };
        return send(200, {
          chainId: quoteId === "q-lifi" ? 1 : 1,
          to: ROUTER,
          data: "0xc0ffee",
          value: "0",
          execution: "tx",
          simulation: { ok: true, method: "eth_call", gasUsed: "123456" },
          ...(quoteId.startsWith("q-0x")
            ? {
                permit2: {
                  domain: { name: "Permit2", chainId: 1 },
                  types: { PermitTransferFrom: [{ name: "nonce", type: "uint256" }] },
                  primaryType: "PermitTransferFrom",
                  message: { nonce: "1" },
                },
              }
            : {}),
        });
      }
      case "/status":
        return send(200, {
          status: q.get("txHash")?.endsWith("00") ? "pending" : "done",
          receivingTxHash: null,
        });
      default:
        return send(404, { error: "not found" });
    }
  });
  return new Promise((r) =>
    server.listen(port, "127.0.0.1", () => {
      const a = server.address();
      r({ server, url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : port}`, calls });
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startMockApi(Number(process.env.PORT ?? 8787));
  console.error(`mock SwapChan API on ${url}`);
}
