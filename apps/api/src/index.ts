import { health } from "./scanctx.js";
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
import { fanOut, logGuardFailure } from "./aggregate.js";
import { apiKeyAuth, parseKeys } from "./auth.js";
import { mempoolUtxos } from "./btc.js";
import {
  buildPayload,
  failures,
  type GuardCtx,
  liveGuardCtx,
  verifyPayload,
} from "./guard/index.js";
import { intelRoutes, linkRoutes, migrateStrayLinks } from "./intel.js";
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
  /** Payload guard (router allowlist + calldata checks). Default: live THORChain/Relay/0x data. */
  guard?: GuardCtx;
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
  /** quoteId -> ranked sibling quote ids from the same /quotes call (build fallback order). */
  const siblings = new Map<string, string[]>();
  const guard = opts.guard ?? liveGuardCtx(env);
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

  // liveness for the docker healthcheck / watchdog: 503 when scans time out en masse, heap is near the limit or the loop is stalled
  app.get("/healthz", (c) => {
    const h = health();
    return c.json(h, h.ok ? 200 : 503);
  });
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
    const res = await fanOut(providers, QuoteRequest.parse(rest), 8000, undefined, pricer, guard);
    const ids = res.quotes.map((q) => q.id);
    for (const q of res.quotes) {
      cache.set(q.id, q);
      siblings.set(q.id, ids);
    }
    if (cache.size > 100_000) {
      cache.clear();
      siblings.clear();
    }
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
    const quoteFn = async (q: {
      fromChainId: number;
      fromToken: string;
      toChainId: number;
      toToken: string;
      amount: string;
    }) => {
      const res = await quotes({
        fromChainId: String(q.fromChainId),
        toChainId: String(q.toChainId),
        fromToken: q.fromToken,
        toToken: q.toToken,
        amount: q.amount,
      });
      const b = res.quotes[0];
      return b
        ? {
            id: b.id,
            provider: b.provider,
            toAmount: b.toAmount,
            netUsd: (b as { netUsd?: number | null }).netUsd ?? null,
          }
        : null;
    };
    // Permanent short links (never expire, never reused): $SWAPCHAN_DATA_DIR/links.db.
    const linksDb = openWatchDb(
      env.SWAPCHAN_DATA_DIR ? `${env.SWAPCHAN_DATA_DIR}/links.db` : ":memory:",
    );
    migrateStrayLinks(watchDb, linksDb);
    app.route("/onchain", intelRoutes(opts.scannerFetch ?? fetch, env, watchDb, quoteFn, linksDb));
    app.route("/links", linkRoutes(opts.scannerFetch ?? fetch, env, linksDb));
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
    // Build the requested route; if its payload fails verification, fall back to the next
    // best route from the same /quotes call. Nothing unverified is ever returned.
    const order = [
      q,
      ...(siblings.get(quoteId) ?? [])
        .map((id) => cache.get(id)!)
        .filter((x) => x && x.id !== q.id),
    ];
    let first: { quoteId: string; provider: string; reason: string } | undefined;
    for (const cand of order) {
      const prov = providers.find((x) => x.name === cand.provider);
      if (!prov) continue;
      const creq = {
        ...req,
        ...cand.request,
        taker,
        ...(recipient ? { recipient: recipient as `0x${string}` } : {}),
      };
      let out: BuildResponse | null;
      try {
        out = await buildOne(prov, creq);
      } catch (e) {
        if (cand === q) throw e;
        continue;
      }
      if (!out) {
        if (cand === q) return c.json({ error: "provider returned no tx" }, 502);
        continue;
      }
      const v = await verifyPayload(buildPayload(cand, creq, out), guard);
      if (!v.verified) {
        const reason = v.checks.some((x) => !x.ok) ? failures(v) : `not verified (${v.level})`;
        logGuardFailure("build", cand.provider, creq.fromChainId, reason);
        first ??= { quoteId: cand.id, provider: cand.provider, reason };
        continue;
      }
      if (simulator && out.execution === "tx" && isEvmChain(out.chainId))
        out = { ...out, simulation: await simulator(out, taker) };
      return c.json(
        BuildResponse.parse({
          ...out,
          verified: true,
          verification: v,
          quoteId: cand.id,
          provider: cand.provider,
          ...(first ? { fallbackFrom: first } : {}),
        }),
      );
    }
    return c.json(
      { error: "no route passed payload verification", rejected: first ?? null, verified: false },
      502,
    );
  });
  async function buildOne(p: ProviderAdapter, req: QuoteRequest): Promise<BuildResponse | null> {
    const signal = AbortSignal.timeout(10_000);
    if (p.build) return p.build(req, signal);
    const fresh = await p.quote(req, signal);
    if (fresh.execution === "order" && fresh.order)
      // CoW: nothing to send; return order typed data (tx fields point at settlement for reference).
      return {
        chainId: req.fromChainId,
        to: fresh.order.domain.verifyingContract as `0x${string}`,
        data: "0x",
        value: "0",
        execution: "order",
        order: fresh.order,
      };
    if (fresh.nonEvmTx)
      // Non-EVM origin: hand back the provider's payload for the Solana/Bitcoin/Tron wallet.
      return {
        chainId: req.fromChainId,
        to: "0x0000000000000000000000000000000000000000",
        data: "0x",
        value: "0",
        execution: "nonevm",
        nonEvmTx: fresh.nonEvmTx,
      };
    if (fresh.tx)
      return {
        ...fresh.tx,
        execution: "tx",
        ...(fresh.relayOrder ? { relayOrder: fresh.relayOrder } : {}),
      };
    return null;
  }
  app.route("/limit", limitRoutes(opts.cowFetch ?? fetch, env));
  app.get("/status", async (c) => {
    const req = StatusRequest.parse(c.req.query());
    const p = providers.find((x) => x.name === req.provider);
    if (!p?.status) return c.json({ error: "status unsupported for provider" }, 400);
    return c.json(await p.status(req, AbortSignal.timeout(8000)));
  });
  return app;
}
