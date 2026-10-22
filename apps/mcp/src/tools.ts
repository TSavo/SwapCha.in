import { McpServer } from "@modelcontextprotocol/server";
import {
  COW_NETWORK,
  fromBaseUnits,
  isAnyAddress,
  isVmAddress,
  NATIVE_TOKEN,
  type Quote,
  type QuoteRequest,
  type Token,
  toBaseUnits,
  vmOf,
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
import { imageData, mascotsFor, SITE, SWAP_CHAN, swapUrl } from "./art.js";
import type { Config } from "./config.js";

export const SERVER_NAME = "swapchan";
export const SERVER_VERSION = "0.1.0";

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; mimeType: string; description?: string };
type ToolResult = { content: Content[]; isError?: boolean };

/** What a tool shows with its result: which chans, Swap-chan's line, and a prefilled swap link. */
export interface Art {
  fromChainId?: number | undefined;
  toChainId?: number | undefined;
  says: string;
  swapUrl?: string | undefined;
}

const DISPLAY_HINT =
  "Show the user the `display` markdown as-is: the chan image(s) inline, Swap-chan's line, and the swapUrl link to execute on swapchan.com.";

async function ok(data: unknown, art?: Art): Promise<ToolResult> {
  if (!art) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  const mascots = mascotsFor(art.fromChainId, art.toChainId);
  const display = [
    mascots.map((m) => m.markdown).join(" "),
    `**Swap-chan:** ${art.says}`,
    ...(art.swapUrl ? [`[Swap it on SwapChan →](${art.swapUrl})`] : []),
  ].join("\n\n");
  const body = {
    ...(data && typeof data === "object" && !Array.isArray(data) ? data : { result: data }),
    swapchanSays: art.says,
    mascots,
    ...(art.swapUrl ? { swapUrl: art.swapUrl } : {}),
    display,
    displayHint: DISPLAY_HINT,
  };
  const primary = mascots[mascots.length - 1] ?? SWAP_CHAN;
  const img = await imageData(primary.imageUrl);
  return {
    content: [
      { type: "text", text: JSON.stringify(body, null, 2) },
      ...(img ? [{ type: "image" as const, data: img, mimeType: "image/png" }] : []),
      ...mascots.map((m) => ({
        type: "resource_link" as const,
        uri: m.imageUrl,
        name: m.name,
        mimeType: "image/png",
        description: m.alt,
      })),
    ],
  };
}
export const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: `Error: ${message}` }],
  isError: true,
});

/** Wrap a handler so every failure becomes a clear MCP tool error instead of a protocol error. */
const safe =
  <A, R = unknown>(fn: (a: A) => Promise<R>, art?: (a: A, r: R) => Art) =>
  async (a: A): Promise<ToolResult> => {
    try {
      const r = await fn(a);
      return await ok(r, art?.(a, r));
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

const PUBLIC_API = "https://api.swapchan.com";

/** ERC-20 allowance via the configured RPC; null when no RPC for that chain. */
async function readAllowance(
  cfg: Config,
  chain: number,
  token: string,
  owner: string,
  spender: string,
) {
  const rpc = cfg.rpcUrls[chain];
  if (!rpc) return null;
  return createPublicClient({ transport: http(rpc) }).readContract({
    address: token as ViemAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner as ViemAddress, spender as ViemAddress],
  });
}

const addr = z
  .string()
  .refine((a) => isAnyAddress(a), "must be an EVM, Solana, Bitcoin or Tron address")
  .describe(
    `Token address. Native gas token: ${NATIVE_TOKEN} on EVM chains (ETH, POL...), 11111111111111111111111111111111 for SOL, bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8 for BTC, T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb for TRX. SPL mints and TRC-20 addresses work as-is (e.g. Solana USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, Tron USDT TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t).`,
  );
const chainId = z
  .number()
  .int()
  .positive()
  .describe(
    "Chain id: 1 Ethereum, 8453 Base, 42161 Arbitrum, 10 Optimism, 137 Polygon, 56 BNB Chain, 43114 Avalanche, 59144 Linea, 534352 Scroll, 792703809 Solana, 8253038 Bitcoin, 728126428 Tron. Non-EVM chains route via Relay and LI.FI.",
  );

function swapShape(cfg: Config) {
  return {
    fromChainId: chainId,
    toChainId: chainId.describe(
      "Destination chain id. Same as fromChainId for a same-chain swap; different for a cross-chain route.",
    ),
    fromToken: addr,
    toToken: addr,
    recipient: z
      .string()
      .refine((a) => isAnyAddress(a), "invalid address")
      .optional()
      .describe(
        "Address that receives the output on toChainId. Required for real execution when the destination is a different VM (e.g. EVM -> Solana/Bitcoin/Tron); omitted = indicative quote only.",
      ),
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
  recipient?: string | undefined;
  slippageBps: number;
};

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function findToken(
  api: SwapChanApi,
  chain: number,
  address: string,
): Promise<Token | undefined> {
  const list = await api.tokens(chain);
  // Not listed: any ERC-20 by address works; the API reads its decimals on-chain.
  return (
    list.find((t) => sameAddr(t.address, address)) ?? (await api.token(chain, address)) ?? undefined
  );
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
        `unknown token ${a.fromToken} on chain ${a.fromChainId}; it is not an ERC-20 on that chain (any token address works; pass amountBaseUnits to skip the lookup)`,
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
    ...(a.recipient ? { recipient: a.recipient as `0x${string}` } : {}),
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
    swapchanFeeUsd: q.ourFeeUsd ?? 0,
    ...(q.feeRecipient ? { swapchanFeeRecipient: q.feeRecipient } : {}),
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
        "SwapChan finds the best-price route for token swaps across EVM chains plus Solana, Bitcoin and Tron (same-chain and cross-chain; pass `recipient` when the destination is a different VM) by asking many aggregators and bridges at once. Typical flow: get_supported_tokens -> get_quote or compare_routes -> build_swap_tx (unsigned; the user's wallet signs) -> get_route_status. This server never holds keys and never signs or broadcasts. Every result carries chain-chan mascots, a line from Swap-chan and usually a swapUrl: always show the user the ready-made `display` markdown (chan images inline as ![alt](imageUrl), then the swapUrl link) so they can see the chans and execute on swapchan.com with their own wallet.",
    },
  );
  const swap = swapShape(cfg);
  const ro = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool(
    "get_supported_chains",
    {
      title: "Supported chains",
      description:
        "List the chains SwapChan routes on, each with its chain-chan mascot. Swap-chan says: pick your departure gate! Result includes `display` markdown with chan images and a swapchan.com link: show it to the user.",
      inputSchema: z.object({}),
      annotations: ro,
    },
    safe(
      async () => api.chains(),
      () => ({ says: "Pick your departure gate! Every chain-chan is ready to carry your tokens~" }),
    ),
  );

  server.registerTool(
    "get_supported_tokens",
    {
      title: "Supported tokens",
      description:
        "List tokens SwapChan knows (address, symbol, decimals), optionally for one chain or filtered by symbol/name. Swap-chan keeps the coin purse tidy. Result includes `display` markdown with chan images and a swapchan.com link: show it to the user.",
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
      (a) => ({
        fromChainId: a.chainId,
        says: "Here's the coin purse! Paste any token address if yours isn't listed~",
      }),
    ),
  );

  server.registerTool(
    "get_quote",
    {
      title: "Best quote",
      description:
        "Get SwapChan's single best quote (most value landing in the wallet after gas and fees) for a same-chain or cross-chain swap. Read-only, no transaction. Swap-chan checks every counter so you don't have to. Result includes `display` markdown with chan images and a swapchan.com link: show it to the user.",
      inputSchema: z.object(swap),
      annotations: ro,
    },
    safe(
      async (a: SwapArgs) => {
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
      },
      (a, r) => ({
        fromChainId: a.fromChainId,
        toChainId: a.toChainId,
        says: `I asked every aggregator and bridge: ${r.best.provider} wins with ${r.best.toAmountFormatted ?? r.best.toAmount} out!`,
        swapUrl: swapUrl(a),
      }),
    ),
  );

  server.registerTool(
    "compare_routes",
    {
      title: "Compare routes",
      description:
        "Compare every route SwapChan found, ranked best-first by net USD received, across aggregators and bridges. Pass extra destination chains in alsoToChainIds to compare same-chain vs cross-chain outcomes side by side. Swap-chan lines up the whole cast. Result includes `display` markdown with chan images and a swapchan.com link: show it to the user.",
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
    safe(
      async (a: SwapArgs & { alsoToChainIds?: number[] | undefined; limit: number }) => {
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
          } else
            errors.push({ provider: `chain ${dests[i]}`, message: (r.reason as Error).message });
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
          note: "Ranked by netUsd = toAmount priced by SwapChan (same price for every route) - gasUsd; unpriced routes follow, by raw toAmount.",
        };
      },
      (a, r) => ({
        fromChainId: a.fromChainId,
        toChainId: a.toChainId,
        says: r.routes[0]
          ? `${r.totalFound} routes lined up! ${r.routes[0].provider} is in front~`
          : "Uwaa, nobody had a route for that one.",
        swapUrl: swapUrl(a),
      }),
    ),
  );

  server.registerTool(
    "build_swap_tx",
    {
      title: "Build unsigned swap transaction",
      description:
        "Build the UNSIGNED transaction for the best (or chosen) route, plus any ERC-20 approval needed first and an eth_call simulation when an RPC is configured. Never signs, never broadcasts, never asks for keys: hand the result to the user's wallet. Swap-chan packs the bag; you carry it through the gate. Result includes `display` markdown with chan images and a swapchan.com link: show it to the user.",
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
        if (!isVmAddress(a.taker, vmOf(pick.request.fromChainId)))
          throw new UserError(
            `taker ${a.taker} is not a ${vmOf(pick.request.fromChainId)} address for chain ${pick.request.fromChainId}`,
          );
        if (vmOf(pick.request.toChainId) !== vmOf(pick.request.fromChainId) && !a.recipient)
          throw new UserError(
            "cross-VM route: pass recipient (the receiving address on the destination chain)",
          );
        const built = await api.build(pick.id, a.taker, a.recipient);
        if (built.execution === "nonevm" && built.nonEvmTx) {
          const how: Record<string, string> = {
            "svm-base64":
              "`data` is a base64 serialized Solana VersionedTransaction: deserialize, have the user's Solana wallet sign, send to a Solana RPC.",
            "svm-instructions":
              "`data.instructions` are Solana instructions (Relay format): compile a v0 message with `addressLookupTableAddresses` and a fresh blockhash, have the user's Solana wallet sign and send.",
            "bvm-psbt":
              "`data` is a Bitcoin PSBT (or deposit request): have the user's Bitcoin wallet sign and broadcast it.",
            "tvm-json":
              "`data` is a Tron transaction request: have the user's Tron wallet (TronLink) sign and broadcast it.",
          };
          return {
            quote: await summarize(api, pick),
            execution: "nonevm",
            unsignedTx: built.nonEvmTx,
            howToExecute: how[built.nonEvmTx.kind],
            safety: "Unsigned. SwapChan never holds keys or signs.",
          };
        }
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
      (a) => ({
        fromChainId: a.fromChainId,
        toChainId: a.toChainId,
        says: "Your transaction is ready! Sign it in your own wallet, or swap on SwapChan with one click~",
        swapUrl: swapUrl(a),
      }),
    ),
  );

  server.registerTool(
    "get_route_status",
    {
      title: "Route status",
      description:
        "Track a submitted swap or cross-chain transfer by source tx hash: pending, done, failed or not_found, plus the destination tx hash once it lands. Swap-chan waves from the arrival gate. Result includes `display` markdown with chan images and a swapchan.com link: show it to the user.",
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
    safe(
      async (a: { provider: string; txHash: string; fromChainId: number; toChainId: number }) =>
        api.status({ ...a, txHash: a.txHash as `0x${string}` }),
      (a, r) => ({
        fromChainId: a.fromChainId,
        toChainId: a.toChainId,
        says:
          r.status === "done"
            ? "It landed! Your tokens are home~"
            : r.status === "failed"
              ? "Uwaa, that one failed. Check the source tx."
              : "Still in flight, I'm watching the arrival gate~",
      }),
    ),
  );

  const evm = z
    .string()
    .refine((a) => isAddress(a), "EVM address")
    .describe("EVM address");
  const cowChain = z
    .number()
    .int()
    .refine((c) => c in COW_NETWORK, "CoW limit orders: 1, 8453, 42161, 137, 56, 43114, 59144")
    .describe(
      "Chain id where CoW runs: 1 Ethereum, 8453 Base, 42161 Arbitrum, 137 Polygon, 56 BNB, 43114 Avalanche, 59144 Linea",
    );

  server.registerTool(
    "build_limit_order",
    {
      title: "Build a limit order",
      description:
        "Build a gasless CoW Protocol limit order (sell an ERC-20 for at least a target amount, valid until expiry). Returns EIP-712 typed data for the user's wallet to sign, the ERC-20 approve tx for CoW's vault relayer if the allowance is short, the current market amount for reference, and how to submit the signature. Never signs or submits. Result includes `display` markdown with chan images: show it to the user.",
      inputSchema: z.object({
        chainId: cowChain,
        owner: evm.describe("Wallet that signs and owns the order"),
        sellToken: evm.describe("ERC-20 to sell (not the native token; wrap first)"),
        buyToken: evm.describe("Token to receive"),
        sellAmount: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .describe('Human amount to sell, e.g. "100"'),
        buyAmount: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .optional()
          .describe("Minimum human amount to receive (the limit). Provide this OR limitPrice."),
        limitPrice: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .optional()
          .describe("Price in buyToken per 1 sellToken. Provide this OR buyAmount."),
        expiresInHours: z.number().min(0.1).max(8760).default(168).describe("Default 168 (7 days)"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(
      async (a: {
        chainId: number;
        owner: string;
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        buyAmount?: string | undefined;
        limitPrice?: string | undefined;
        expiresInHours: number;
      }) => {
        if ((a.buyAmount === undefined) === (a.limitPrice === undefined))
          throw new UserError("provide exactly one of buyAmount or limitPrice");
        const [sd, bd] = await Promise.all([
          decimalsOf(api, a.chainId, a.sellToken),
          decimalsOf(api, a.chainId, a.buyToken),
        ]);
        if (sd === undefined || bd === undefined)
          throw new UserError("unknown token on that chain");
        const sell = toBaseUnits(a.sellAmount, sd);
        const buy =
          a.buyAmount !== undefined
            ? toBaseUnits(a.buyAmount, bd)
            : (sell * toBaseUnits(a.limitPrice as string, 18) * 10n ** BigInt(bd)) /
              (10n ** 18n * 10n ** BigInt(sd));
        const built = await api.limitBuild({
          chainId: a.chainId,
          owner: a.owner,
          sellToken: a.sellToken,
          buyToken: a.buyToken,
          sellAmount: sell.toString(),
          buyAmount: buy.toString(),
          validTo: Math.floor(Date.now() / 1000) + Math.round(a.expiresInHours * 3600),
        });
        let approvalTx: unknown = null;
        try {
          const allowance = await readAllowance(
            cfg,
            a.chainId,
            a.sellToken,
            a.owner,
            built.approvalAddress,
          );
          if (allowance !== null && allowance < sell)
            approvalTx = {
              chainId: a.chainId,
              to: a.sellToken,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [built.approvalAddress as ViemAddress, sell],
              }),
              value: "0",
            };
        } catch {}
        return {
          typedData: built.order,
          appData: built.appData,
          appDataHash: built.appDataHash,
          swapchanFee: built.partnerFee,
          approvalSpender: built.approvalAddress,
          approvalTx,
          approvalNote:
            approvalTx === null
              ? "If the owner's allowance for sellToken to approvalSpender is below the sell amount, send an ERC-20 approve(approvalSpender, amount) first."
              : "Send approvalTx first, wait for it to confirm, then sign.",
          limitBuyAmount: buy.toString(),
          limitBuyAmountFormatted: fromBaseUnits(buy, bd),
          marketBuyAmountFormatted: built.market ? fromBaseUnits(built.market.buyAmount, bd) : null,
          submit: {
            method: "POST",
            url: `${PUBLIC_API}/limit/submit`,
            body: {
              chainId: a.chainId,
              owner: a.owner,
              order: "typedData.message",
              signature: "0x<eip712 signature>",
            },
            note: "Sign typedData with eth_signTypedData_v4 from the owner wallet (after approvalTx if present), then POST. Returns the order uid and a CoW Explorer link.",
          },
          safety:
            "Nothing is signed or sent. The order only fills at or above the limit; cancel anytime (gasless) via cancel_limit_order.",
        };
      },
      (a, r) => ({
        fromChainId: a.chainId,
        says: `Limit order ready: at least ${r.limitBuyAmountFormatted} out${r.marketBuyAmountFormatted ? ` (market now ${r.marketBuyAmountFormatted})` : ""}. Sign it and the solvers wait for your price~`,
        swapUrl: SITE,
      }),
    ),
  );

  server.registerTool(
    "list_limit_orders",
    {
      title: "List limit orders",
      description:
        "List a wallet's CoW limit orders on one chain with status (open, fulfilled, cancelled, expired), amounts filled and an explorer link. Result includes `display` markdown with chan images: show it to the user.",
      inputSchema: z.object({ chainId: cowChain, owner: evm }),
      annotations: ro,
    },
    safe(
      async (a: { chainId: number; owner: string }) => ({
        orders: await api.limitOrders(a.chainId, a.owner),
      }),
      (a, r) => ({
        fromChainId: a.chainId,
        says: r.orders.length
          ? `You have ${r.orders.length} limit order(s). I'm keeping an eye on them~`
          : "No limit orders here yet!",
      }),
    ),
  );

  server.registerTool(
    "cancel_limit_order",
    {
      title: "Cancel a limit order",
      description:
        "Get the EIP-712 OrderCancellations typed data to cancel a CoW limit order off-chain (gasless). The owner signs it; POST {chainId, orderUids:[uid], signature} to /limit/cancel on the SwapChan API. Never signs.",
      inputSchema: z.object({ chainId: cowChain, uid: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
      annotations: ro,
    },
    safe(
      async (a: { chainId: number; uid: string }) => ({
        typedData: await api.limitCancelData(a.chainId, a.uid),
        submit: {
          method: "POST",
          url: `${PUBLIC_API}/limit/cancel`,
          body: { chainId: a.chainId, orderUids: [a.uid], signature: "0x<eip712 signature>" },
        },
      }),
      (a) => ({ fromChainId: a.chainId, says: "Sign this and the order's gone, no gas needed~" }),
    ),
  );

  return server;
}
