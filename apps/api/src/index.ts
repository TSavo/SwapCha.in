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
import { mempoolUtxos } from "./btc.js";
import { limitRoutes } from "./limit.js";
import { type BestOut, onchainRoutes, openWatchDb } from "./onchain.js";
import {
  getPartner,
  openPartnerStore,
  type PartnerStore,
  partnerRoutes,
  recordQuote,
} from "./partners.js";
import { llamaPricer, type Pricer } from "./pricing.js";
import { across } from "./providers/across.js";
import { cow } from "./providers/cow.js";
import { debridge } from "./providers/debridge.js";
import { jupiter } from "./providers/jupiter.js";
import { kyberswap } from "./providers/kyberswap.js";
import { lifi } from "./providers/lifi.js";
import { oneinch } from "./providers/oneinch.js";
import { relay } from "./providers/relay.js";
import { thorchain } from "./providers/thorchain.js";
import type { Fetch, ProviderAdapter } from "./providers/types.js";
import { velora } from "./providers/velora.js";
import { zerox } from "./providers/zerox.js";
import { scannerRoutes } from "./scanner.js";
import { openSeoStore, seoRoutes, startSeoJob } from "./seo.js";
import { createSimulator, type Simulator } from "./simulate.js";
import {
  jupiterTokenReader,
  onchainReader,
  type SolanaReader,
  type TokenReader,
  tokenResolver,
} from "./tokens.js";

export { fanOut, rank } from "./aggregate.js";
export type { ProviderAdapter } from "./providers/types.js";

let sharedPricer: Pricer | undefined;
/** One DefiLlama pricer per process, shared by providers and ranking (same price for every route). */
export function defaultPricer(env: NodeJS.ProcessEnv = process.env): Pricer {
  sharedPricer ??= llamaPricer(fetch, 60_000, async (chainId, address) => {
    const t = await tokenResolver(onchainReader(env), jupiterTokenReader(env))(chainId, address);
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
    jupiter(pricer, env),
    kyberswap(pricer, env),
    oneinch(pricer, env),
    debridge(pricer, env),
    thorchain(pricer, env, fetch, mempoolUtxos()),
  ];
}

export interface AppOptions {
  env?: NodeJS.ProcessEnv;
  simulator?: Simulator | null;
  /** On-chain ERC-20 metadata reader for pasted (unlisted) addresses. */
  tokenReader?: TokenReader;
  /** SPL mint metadata reader (Jupiter token API) for pasted Solana mints. */
  solanaReader?: SolanaReader;
  /** Scanner upstream fetch (tests inject); null disables /scanner routes. */
  scannerFetch?: typeof fetch | null;
  /** Prices every route's output for ranking; never trust provider-reported USD. */
  pricer?: Pricer | null;
  /** fetch used for CoW limit-order calls (tests inject a mock). */
  cowFetch?: Fetch;
  /** Widget partner store; null disables /partners. Default: SQLite at $SWAPCHAN_DATA_DIR/partners.db (in-memory when unset). */
  partners?: PartnerStore | null;
  /** SEO trending-token store; null disables /seo. Default: $SWAPCHAN_DATA_DIR/seo.db + 30-min job. */
  seo?: import("node:sqlite").DatabaseSync | null;
}

export function createApp(
  providers: ProviderAdapter[] = defaultProviders(),
  opts: AppOptions = {},
) {
  const env = opts.env ?? process.env;
  const simulator = opts.simulator !== undefined ? opts.simulator : createSimulator(env);
  const cache = new Map<string, Quote>();
  const pricer = opts.pricer === undefined ? defaultPricer(env) : opts.pricer;
  const resolveToken = tokenResolver(
    opts.tokenReader ?? onchainReader(env),
    opts.solanaReader ?? jupiterTokenReader(env),
  );
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
    return t ? c.json(t) : c.json({ error: "not a token on this chain" }, 404);
  });
  if (opts.scannerFetch !== null)
    app.route("/scanner", scannerRoutes(opts.scannerFetch ?? fetch, env));
  if (opts.scannerFetch !== null && opts.seo !== null) {
    const seoDb =
      opts.seo ??
      openSeoStore(env.SWAPCHAN_DATA_DIR ? `${env.SWAPCHAN_DATA_DIR}/seo.db` : ":memory:");
    app.route("/seo", seoRoutes(seoDb, opts.scannerFetch ?? fetch));
    if (opts.seo === undefined && env.SWAPCHAN_DATA_DIR && env.SWAPCHAN_SEO_JOB !== "0")
      startSeoJob(seoDb, opts.scannerFetch ?? fetch, env);
  }
  const partners =
    opts.partners !== undefined
      ? opts.partners
      : openPartnerStore(
          env.SWAPCHAN_DATA_DIR ? `${env.SWAPCHAN_DATA_DIR}/partners.db` : ":memory:",
          Number(env.SWAPCHAN_PARTNER_SHARE_BPS ?? 5000),
        );
  const quotePartner = new Map<string, string>();
  if (partners) app.route("/partners", partnerRoutes(partners, cache, quotePartner));
  const quotes = async (query: Record<string, string>) => {
    const { partner, ...rest } = query;
    const res = await fanOut(providers, QuoteRequest.parse(rest), 8000, undefined, pricer);
    for (const q of res.quotes) cache.set(q.id, q);
    // Widget attribution: ?partner=<id> tags these quotes for that partner's revenue share.
    const p = partners && partner ? getPartner(partners, partner) : undefined;
    if (partners && p) {
      for (const q of res.quotes) quotePartner.set(q.id, p.id);
      if (res.quotes[0]) recordQuote(partners, p.id, res.quotes[0]);
      if (quotePartner.size > 50_000) quotePartner.clear();
    }
    return res;
  };
  app.get("/quotes", async (c) => c.json(await quotes(c.req.query())));
  app.get("/quote", async (c) => {
    const res = await quotes(c.req.query());
    const best = res.quotes[0];
    return best ? c.json(best) : c.json({ error: "no route", errors: res.errors }, 404);
  });
  if (opts.scannerFetch !== null) {
    const watchDb = openWatchDb(
      env.SWAPCHAN_DATA_DIR ? `${env.SWAPCHAN_DATA_DIR}/watches.db` : ":memory:",
    );
    // Watches compare the best route's raw output (base units of toToken) between checks.
    const bestOut: BestOut = async (q) => {
      const res = await quotes({
        fromChainId: String(q.fromChainId),
        toChainId: String(q.toChainId),
        fromToken: q.fromToken,
        toToken: q.toToken,
        amount: q.amount,
      });
      const best = res.quotes[0];
      return best ? Number(best.toAmount) : null;
    };
    app.route("/onchain", onchainRoutes(opts.scannerFetch ?? fetch, env, watchDb, bestOut));
  }
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
