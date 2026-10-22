import {
  Address,
  API_VERSION,
  BuildResponse,
  isEvmChain,
  type Quote,
  QuoteRequest,
  StatusRequest,
  SUPPORTED_CHAINS,
  tokenList,
  vmOf,
} from "@swapchan/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { fanOut } from "./aggregate.js";
import { apiKeyAuth, parseKeys } from "./auth.js";
import { limitRoutes } from "./limit.js";
import { llamaPricer, type Pricer } from "./pricing.js";
import { across } from "./providers/across.js";
import { cow } from "./providers/cow.js";
import { lifi } from "./providers/lifi.js";
import { relay } from "./providers/relay.js";
import type { Fetch, ProviderAdapter } from "./providers/types.js";
import { velora } from "./providers/velora.js";
import { zerox } from "./providers/zerox.js";
import { createSimulator, type Simulator } from "./simulate.js";
import { onchainReader, type TokenReader, tokenResolver } from "./tokens.js";

export { fanOut, rank } from "./aggregate.js";
export type { ProviderAdapter } from "./providers/types.js";

let sharedPricer: Pricer | undefined;
/** One DefiLlama pricer per process, shared by providers and ranking (same price for every route). */
export function defaultPricer(env: NodeJS.ProcessEnv = process.env): Pricer {
  sharedPricer ??= llamaPricer(fetch, 60_000, async (chainId, address) => {
    const t = await tokenResolver(onchainReader(env))(chainId, address);
    return t?.decimals ?? null;
  });
  return sharedPricer;
}

export function defaultProviders(
  env: NodeJS.ProcessEnv = process.env,
  pricer: Pricer = defaultPricer(env),
): ProviderAdapter[] {
  return [
    lifi(env),
    zerox(env, pricer),
    cow(pricer, fetch, env),
    velora(pricer, env),
    across(pricer, fetch, env),
    relay(env),
  ];
}

export interface AppOptions {
  env?: NodeJS.ProcessEnv;
  simulator?: Simulator | null;
  /** On-chain ERC-20 metadata reader for pasted (unlisted) addresses. */
  tokenReader?: TokenReader;
  /** Prices every route's output for ranking; never trust provider-reported USD. */
  pricer?: Pricer | null;
  /** fetch used for CoW limit-order calls (tests inject a mock). */
  cowFetch?: Fetch;
}

export function createApp(
  providers: ProviderAdapter[] = defaultProviders(),
  opts: AppOptions = {},
) {
  const env = opts.env ?? process.env;
  const simulator = opts.simulator !== undefined ? opts.simulator : createSimulator(env);
  const cache = new Map<string, Quote>();
  const pricer = opts.pricer === undefined ? defaultPricer(env) : opts.pricer;
  const resolveToken = tokenResolver(opts.tokenReader ?? onchainReader(env));
  const app = new Hono();
  app.use("*", cors());
  app.use("*", apiKeyAuth(parseKeys(env.SWAPCHAN_API_KEYS)));
  app.onError((err, c) =>
    err instanceof z.ZodError
      ? c.json({ error: "invalid request", issues: err.issues }, 400)
      : c.json({ error: err.message }, 500),
  );

  app.get("/health", (c) =>
    c.json({
      ok: true,
      version: API_VERSION,
      providers: providers.filter((p) => p.enabled()).map((p) => p.name),
    }),
  );
  app.get("/chains", (c) =>
    c.json(
      Object.entries(SUPPORTED_CHAINS).map(([id, v]) => ({
        id: Number(id),
        ...v,
        vm: vmOf(Number(id)),
      })),
    ),
  );
  app.get("/tokens", (c) => {
    const id = c.req.query("chainId");
    return c.json(id ? tokenList.filter((t) => t.chainId === Number(id)) : tokenList);
  });
  // Any ERC-20 by address: listed tokens come back verified, others are read on-chain (unverified).
  app.get("/token", async (c) => {
    const q = z
      .object({ chainId: z.coerce.number().int().positive(), address: Address })
      .parse(c.req.query());
    const t = await resolveToken(q.chainId, q.address);
    return t ? c.json(t) : c.json({ error: "not an ERC-20 on this chain" }, 404);
  });
  const quotes = async (query: Record<string, string>) => {
    const res = await fanOut(providers, QuoteRequest.parse(query), 8000, undefined, pricer);
    for (const q of res.quotes) cache.set(q.id, q);
    return res;
  };
  app.get("/quotes", async (c) => c.json(await quotes(c.req.query())));
  app.get("/quote", async (c) => {
    const res = await quotes(c.req.query());
    const best = res.quotes[0];
    return best ? c.json(best) : c.json({ error: "no route", errors: res.errors }, 404);
  });
  app.post("/build", async (c) => {
    const { quoteId, taker } = z
      .object({ quoteId: z.string(), taker: Address, recipient: Address.optional() })
      .parse(await c.req.json());
    const q = cache.get(quoteId);
    const p = q && providers.find((x) => x.name === q.provider);
    if (!q || !p) return c.json({ error: "unknown or expired quote" }, 404);
    const { recipient } = (await c.req.json().catch(() => ({}))) as { recipient?: string };
    const req = {
      ...q.request,
      taker,
      ...(recipient ? { recipient: recipient as `0x${string}` } : {}),
    };
    const signal = AbortSignal.timeout(10_000);
    let out: BuildResponse;
    if (p.build) out = await p.build(req, signal);
    else {
      const fresh = await p.quote(req, signal);
      if (fresh.execution === "order" && fresh.order) {
        // CoW: nothing to send; return order typed data (tx fields point at settlement for reference).
        out = {
          chainId: req.fromChainId,
          to: fresh.order.domain.verifyingContract as `0x${string}`,
          data: "0x",
          value: "0",
          execution: "order",
          order: fresh.order,
        };
      } else if (fresh.nonEvmTx) {
        // Non-EVM origin: hand back the provider's payload for the Solana/Bitcoin/Tron wallet.
        out = {
          chainId: req.fromChainId,
          to: "0x0000000000000000000000000000000000000000",
          data: "0x",
          value: "0",
          execution: "nonevm",
          nonEvmTx: fresh.nonEvmTx,
        };
      } else if (fresh.tx) out = { ...fresh.tx, execution: "tx" };
      else return c.json({ error: "provider returned no tx" }, 502);
    }
    if (simulator && out.execution === "tx" && isEvmChain(out.chainId))
      out = { ...out, simulation: await simulator(out, taker) };
    return c.json(BuildResponse.parse(out));
  });
  app.route("/limit", limitRoutes(opts.cowFetch ?? fetch, env));
  app.get("/status", async (c) => {
    const req = StatusRequest.parse(c.req.query());
    const p = providers.find((x) => x.name === req.provider);
    if (!p?.status) return c.json({ error: "status unsupported for provider" }, 400);
    return c.json(await p.status(req, AbortSignal.timeout(8000)));
  });
  return app;
}
