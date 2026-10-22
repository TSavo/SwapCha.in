import { McpServer } from "@modelcontextprotocol/server";
import {
  fromBaseUnits,
  NATIVE_TOKEN,
  type Quote,
  type QuoteRequest,
  type Token,
  toBaseUnits,
} from "@swapchan/shared";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddress,
  type Address as ViemAddress,
} from "viem";
import { z } from "zod";
import { ApiError, type SwapChanApi } from "./api.js";
import type { Config } from "./config.js";

export const SERVER_NAME = "swapchan";
export const SERVER_VERSION = "0.1.0";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
export const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: `Error: ${message}` }],
  isError: true,
});

/** Wrap a handler so every failure becomes a clear MCP tool error instead of a protocol error. */
const safe =
  <A>(fn: (a: A) => Promise<unknown>) =>
  async (a: A): Promise<ToolResult> => {
    try {
      return ok(await fn(a));
    } catch (e) {
      if (e instanceof UserError) return fail(e.message);
      if (e instanceof ApiError) {
        const hint =
          e.status === 404
            ? " (no route found; try another amount, token or chain)"
            : e.status === 429
              ? " (upstream rate limited; retry shortly)"
              : e.status >= 500
                ? " (SwapChan API problem; retry shortly)"
                : "";
        return fail(`SwapChan API ${e.status}: ${e.message}${hint}`);
      }
      return fail(`unexpected error: ${(e as Error).message}`);
    }
  };

export class UserError extends Error {}

const addr = z
  .string()
  .refine((a) => isAddress(a, { strict: false }), "must be a 0x-prefixed 20-byte EVM address")
  .describe(`Token contract address. Use ${NATIVE_TOKEN} for the native gas token (ETH, POL...).`);
const chainId = z
  .number()
  .int()
  .positive()
  .describe("EVM chain id, e.g. 1 Ethereum, 8453 Base, 42161 Arbitrum, 10 Optimism, 137 Polygon");

function swapShape(cfg: Config) {
  return {
    fromChainId: chainId,
    toChainId: chainId.describe(
      "Destination chain id. Same as fromChainId for a same-chain swap; different for a cross-chain route.",
    ),
    fromToken: addr,
    toToken: addr,
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'decimal string like "1.5"')
      .optional()
      .describe(
        'Human-readable amount of fromToken to sell, e.g. "1.5". Provide this OR amountBaseUnits.',
      ),
    amountBaseUnits: z
      .string()
      .regex(/^\d+$/, "integer string")
      .optional()
      .describe("Exact amount in the token's smallest unit (wei). Provide this OR amount."),
    slippageBps: z
      .number()
      .int()
      .min(1)
      .max(cfg.maxSlippageBps, `slippage capped at ${cfg.maxSlippageBps} bps on this server`)
      .default(cfg.defaultSlippageBps)
      .describe(
        `Max slippage in basis points (50 = 0.5%). Default ${cfg.defaultSlippageBps}, cap ${cfg.maxSlippageBps}.`,
      ),
  };
}

type SwapArgs = {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  amount?: string | undefined;
  amountBaseUnits?: string | undefined;
  slippageBps: number;
};

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function findToken(
  api: SwapChanApi,
  chain: number,
  address: string,
): Promise<Token | undefined> {
  const list = await api.tokens(chain);
  return list.find((t) => sameAddr(t.address, address));
}

async function toRequest(api: SwapChanApi, a: SwapArgs, taker?: string): Promise<QuoteRequest> {
  if ((a.amount === undefined) === (a.amountBaseUnits === undefined))
    throw new UserError("provide exactly one of amount (decimal) or amountBaseUnits (integer)");
  let amount: string;
  if (a.amountBaseUnits !== undefined) amount = a.amountBaseUnits;
  else {
    const decimals = sameAddr(a.fromToken, NATIVE_TOKEN)
      ? 18
      : (await findToken(api, a.fromChainId, a.fromToken))?.decimals;
    if (decimals === undefined)
      throw new UserError(
        `unknown token ${a.fromToken} on chain ${a.fromChainId}; pass amountBaseUnits or pick one from get_supported_tokens`,
      );
    amount = toBaseUnits(a.amount as string, decimals).toString();
  }
  if (BigInt(amount) === 0n) throw new UserError("amount must be greater than zero");
  return {
    fromChainId: a.fromChainId,
    toChainId: a.toChainId,
    fromToken: a.fromToken as `0x${string}`,
    toToken: a.toToken as `0x${string}`,
    amount,
    slippageBps: a.slippageBps,
    ...(taker ? { taker: taker as `0x${string}` } : {}),
  };
}

async function decimalsOf(
  api: SwapChanApi,
  chain: number,
  address: string,
): Promise<number | undefined> {
  if (sameAddr(address, NATIVE_TOKEN)) return 18;
  try {
    return (await findToken(api, chain, address))?.decimals;
  } catch {
    return undefined;
  }
}

async function summarize(api: SwapChanApi, q: Quote) {
  const dec = await decimalsOf(api, q.request.toChainId, q.request.toToken);
  return {
    quoteId: q.id,
    provider: q.provider,
    crossChain: q.request.fromChainId !== q.request.toChainId,
    toAmount: q.toAmount,
    toAmountMin: q.toAmountMin,
    ...(dec !== undefined
      ? {
          toAmountFormatted: fromBaseUnits(q.toAmount, dec),
          toAmountMinFormatted: fromBaseUnits(q.toAmountMin, dec),
        }
      : {}),
    netUsd: q.netUsd,
    gasUsd: q.gasUsd,
    feeUsd: q.feeUsd,
    etaSeconds: q.etaSeconds,
    route: q.steps.map((s) => `${s.type}:${s.tool} ${s.fromChainId}->${s.toChainId}`),
    expiresAt: new Date(q.expiresAt * (q.expiresAt < 1e12 ? 1000 : 1)).toISOString(),
  };
}

/** Builds one McpServer instance with all SwapChan tools. Cheap; called per HTTP request. */
export function createSwapChanServer(api: SwapChanApi, cfg: Config): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: "SwapChan" },
    {
      instructions:
        "SwapChan finds the best-price route for token swaps across EVM chains (same-chain and cross-chain) by asking many aggregators and bridges at once. Typical flow: get_supported_tokens -> get_quote or compare_routes -> build_swap_tx (unsigned; the user's wallet signs) -> get_route_status. This server never holds keys and never signs or broadcasts.",
    },
  );
  const swap = swapShape(cfg);
  const ro = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool(
    "get_supported_chains",
    {
      title: "Supported chains",
      description:
        "List the chains SwapChan routes on, each with its chain-chan mascot. Swap-chan says: pick your departure gate!",
      inputSchema: z.object({}),
      annotations: ro,
    },
    safe(async () => api.chains()),
  );

  server.registerTool(
    "get_supported_tokens",
    {
      title: "Supported tokens",
      description:
        "List tokens SwapChan knows (address, symbol, decimals), optionally for one chain or filtered by symbol/name. Swap-chan keeps the coin purse tidy.",
      inputSchema: z.object({
        chainId: chainId.optional(),
        search: z
          .string()
          .max(64)
          .optional()
          .describe('Case-insensitive symbol or name filter, e.g. "usdc"'),
      }),
      annotations: ro,
    },
    safe(
      async ({
        chainId: c,
        search,
      }: {
        chainId?: number | undefined;
        search?: string | undefined;
      }) => {
        const list = await api.tokens(c);
        const s = search?.toLowerCase();
        return s
          ? list.filter(
              (t) => t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s),
            )
          : list;
      },
    ),
  );

  server.registerTool(
    "get_quote",
    {
      title: "Best quote",
      description:
        "Get SwapChan's single best quote (most value landing in the wallet after gas and fees) for a same-chain or cross-chain swap. Read-only, no transaction. Swap-chan checks every counter so you don't have to.",
      inputSchema: z.object(swap),
      annotations: ro,
    },
    safe(async (a: SwapArgs) => {
      const res = await api.quotes(await toRequest(api, a));
      const best = res.quotes.find((q) => q.id === res.best) ?? res.quotes[0];
      if (!best)
        throw new UserError(
          `no route found. Provider errors: ${res.errors.map((e) => `${e.provider}: ${e.message}`).join("; ") || "none"}`,
        );
      return {
        best: await summarize(api, best),
        alternatives: res.quotes.length - 1,
        providerErrors: res.errors,
      };
    }),
  );

  server.registerTool(
    "compare_routes",
    {
      title: "Compare routes",
      description:
        "Compare every route SwapChan found, ranked best-first by net USD received, across aggregators and bridges. Pass extra destination chains in alsoToChainIds to compare same-chain vs cross-chain outcomes side by side. Swap-chan lines up the whole cast.",
      inputSchema: z.object({
        ...swap,
        alsoToChainIds: z
          .array(chainId)
          .max(4)
          .optional()
          .describe(
            "Extra destination chains to compare. toToken must then be valid on each (e.g. native token).",
          ),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      annotations: ro,
    },
    safe(async (a: SwapArgs & { alsoToChainIds?: number[] | undefined; limit: number }) => {
      const base = await toRequest(api, a);
      const dests = [...new Set([a.toChainId, ...(a.alsoToChainIds ?? [])])];
      const results = await Promise.allSettled(
        dests.map((d) => api.quotes({ ...base, toChainId: d })),
      );
      const quotes: Quote[] = [];
      const errors: { provider: string; message: string }[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          quotes.push(...r.value.quotes);
          errors.push(...r.value.errors);
        } else errors.push({ provider: `chain ${dests[i]}`, message: (r.reason as Error).message });
      });
      quotes.sort((x, y) => {
        if (x.netUsd !== null && y.netUsd !== null) return y.netUsd - x.netUsd;
        if (x.netUsd !== null) return -1;
        if (y.netUsd !== null) return 1;
        return BigInt(y.toAmount) > BigInt(x.toAmount)
          ? 1
          : BigInt(y.toAmount) < BigInt(x.toAmount)
            ? -1
            : 0;
      });
      return {
        routes: await Promise.all(quotes.slice(0, a.limit).map((q) => summarize(api, q))),
        totalFound: quotes.length,
        providerErrors: errors,
        note: "Ranked by netUsd = toAmountUsd - gasUsd - feeUsd; unpriced routes follow, by raw toAmount.",
      };
    }),
  );

  server.registerTool(
    "build_swap_tx",
    {
      title: "Build unsigned swap transaction",
      description:
        "Build the UNSIGNED transaction for the best (or chosen) route, plus any ERC-20 approval needed first and an eth_call simulation when an RPC is configured. Never signs, never broadcasts, never asks for keys: hand the result to the user's wallet. Swap-chan packs the bag; you carry it through the gate.",
      inputSchema: z.object({
        ...swap,
        taker: addr.describe("Wallet address that will sign and send the transaction"),
        provider: z
          .string()
          .optional()
          .describe("Force a specific provider from compare_routes instead of the best route"),
        quoteId: z
          .string()
          .optional()
          .describe(
            "Reuse a quoteId from get_quote/compare_routes (still re-quotes if it expired)",
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    safe(
      async (
        a: SwapArgs & {
          taker: string;
          provider?: string | undefined;
          quoteId?: string | undefined;
        },
      ) => {
        // Indicative quotes (no taker) are cheaper on provider rate limits; /build re-quotes with the taker.
        const res = await api.quotes(await toRequest(api, a));
        const pick =
          (a.quoteId && res.quotes.find((q) => q.id === a.quoteId)) ||
          (a.provider
            ? res.quotes.find((q) => q.provider.toLowerCase() === a.provider?.toLowerCase())
            : undefined) ||
          (a.provider ? undefined : (res.quotes.find((q) => q.id === res.best) ?? res.quotes[0]));
        if (!pick)
          throw new UserError(
            a.provider
              ? `provider "${a.provider}" returned no route; available: ${res.quotes.map((q) => q.provider).join(", ") || "none"}`
              : "no route found",
          );
        const built = await api.build(pick.id, a.taker);
        if (built.chainId !== pick.request.fromChainId)
          throw new UserError(
            `API built a tx for chain ${built.chainId}, expected ${pick.request.fromChainId}; refusing`,
          );
        const {
          permit2,
          approval: apiApproval,
          simulation: apiSim,
          execution,
          order,
          ...tx
        } = built;

        const isNative = sameAddr(pick.request.fromToken, NATIVE_TOKEN);
        const rpc = cfg.rpcUrls[tx.chainId];
        const client = rpc ? createPublicClient({ transport: http(rpc) }) : undefined;

        let approval: unknown = { required: false };
        let allowanceOk = true;
        if (apiApproval) {
          allowanceOk = false;
          approval = {
            required: true,
            unsignedApproveTx: apiApproval,
            note: "Send and confirm this first.",
          };
        } else if (!isNative && pick.approvalAddress) {
          let allowance: bigint | null = null;
          if (client) {
            try {
              allowance = await client.readContract({
                address: pick.request.fromToken as ViemAddress,
                abi: erc20Abi,
                functionName: "allowance",
                args: [a.taker as ViemAddress, pick.approvalAddress as ViemAddress],
              });
            } catch {
              allowance = null;
            }
          }
          const need = BigInt(pick.request.amount);
          allowanceOk = allowance !== null && allowance >= need;
          approval = allowanceOk
            ? { required: false, currentAllowance: allowance?.toString() }
            : {
                required:
                  allowance === null
                    ? "unknown (no RPC configured; check allowance before sending)"
                    : true,
                spender: pick.approvalAddress,
                currentAllowance: allowance?.toString() ?? null,
                unsignedApproveTx: {
                  chainId: tx.chainId,
                  to: pick.request.fromToken,
                  value: "0",
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [pick.approvalAddress as ViemAddress, need],
                  }),
                },
                note: "Exact-amount approval. Send and confirm this first.",
              };
        }

        if (execution === "order" && order) {
          return {
            quote: await summarize(api, pick),
            execution: "order",
            approval,
            order,
            howToExecute:
              "No transaction. Have the user's wallet sign `order` with eth_signTypedData_v4, then POST the message fields plus { signature, signingScheme: 'eip712', from: taker } to https://api.cow.fi/<network>/api/v1/orders. Solvers pay gas.",
            unsignedTx: null,
            simulation: { status: "skipped", reason: "signed order; nothing to simulate" },
            permit2: null,
            safety: "Unsigned. SwapChan never holds keys or signs.",
          };
        }

        let simulation: unknown = apiSim
          ? { status: apiSim.ok ? "success" : "reverted", via: `api:${apiSim.method}`, ...apiSim }
          : {
              status: "skipped",
              reason: `no simulation configured (API SWAPCHAN_SIMULATE or RPC_URL_${tx.chainId})`,
            };
        if (!apiSim && client) {
          if (!allowanceOk)
            simulation = {
              status: "skipped",
              reason: "approval required before the swap can simulate",
            };
          else {
            try {
              const r = await client.call({
                account: a.taker as ViemAddress,
                to: tx.to,
                data: tx.data,
                value: BigInt(tx.value),
              });
              simulation = { status: "success", via: "mcp:eth_call", returnData: r.data ?? "0x" };
            } catch (e) {
              simulation = {
                status: "reverted",
                reason: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message,
              };
            }
          }
        }

        return {
          quote: await summarize(api, pick),
          execution: "tx",
          approval,
          unsignedTx: tx,
          simulation,
          permit2: permit2 ?? null,
          ...(permit2
            ? {
                permit2Note:
                  "Sign permit2 (EIP-712) with the wallet and append the signature to the tx per provider (0x) docs before sending.",
              }
            : {}),
          safety:
            "Unsigned. SwapChan never holds keys or signs. Review chainId, to, value and toAmountMin in the wallet before signing. Quote expires at quote.expiresAt.",
        };
      },
    ),
  );

  server.registerTool(
    "get_route_status",
    {
      title: "Route status",
      description:
        "Track a submitted swap or cross-chain transfer by source tx hash: pending, done, failed or not_found, plus the destination tx hash once it lands. Swap-chan waves from the arrival gate.",
      inputSchema: z.object({
        provider: z
          .string()
          .min(1)
          .describe('Provider name from the quote (e.g. "across", "lifi")'),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "32-byte 0x tx hash"),
        fromChainId: chainId,
        toChainId: chainId,
      }),
      annotations: ro,
    },
    safe(async (a: { provider: string; txHash: string; fromChainId: number; toChainId: number }) =>
      api.status({ ...a, txHash: a.txHash as `0x${string}` }),
    ),
  );

  return server;
}
