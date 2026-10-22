import {
  Address,
  API_VERSION,
  type Quote,
  QuoteRequest,
  StatusRequest,
  SUPPORTED_CHAINS,
  tokenList,
} from "@swapchan/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { fanOut } from "./aggregate.js";
import { lifi } from "./providers/lifi.js";
import type { ProviderAdapter } from "./providers/types.js";
import { zerox } from "./providers/zerox.js";

export { fanOut, rank } from "./aggregate.js";
export type { ProviderAdapter } from "./providers/types.js";

export function defaultProviders(env: NodeJS.ProcessEnv = process.env): ProviderAdapter[] {
  return [lifi(env), zerox(env)];
}

export function createApp(providers: ProviderAdapter[] = defaultProviders()) {
  const cache = new Map<string, Quote>();
  const app = new Hono();
  app.use("*", cors());
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
    c.json(Object.entries(SUPPORTED_CHAINS).map(([id, v]) => ({ id: Number(id), ...v }))),
  );
  app.get("/tokens", (c) => {
    const id = c.req.query("chainId");
    return c.json(id ? tokenList.filter((t) => t.chainId === Number(id)) : tokenList);
  });
  const quotes = async (query: Record<string, string>) => {
    const res = await fanOut(providers, QuoteRequest.parse(query));
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
      .object({ quoteId: z.string(), taker: Address })
      .parse(await c.req.json());
    const q = cache.get(quoteId);
    const p = q && providers.find((x) => x.name === q.provider);
    if (!q || !p) return c.json({ error: "unknown or expired quote" }, 404);
    const fresh = await p.quote({ ...q.request, taker }, AbortSignal.timeout(8000));
    return fresh.tx ? c.json(fresh.tx) : c.json({ error: "provider returned no tx" }, 502);
  });
  app.get("/status", async (c) => {
    const req = StatusRequest.parse(c.req.query());
    const p = providers.find((x) => x.name === req.provider);
    if (!p?.status) return c.json({ error: "status unsupported for provider" }, 400);
    return c.json(await p.status(req, AbortSignal.timeout(8000)));
  });
  return app;
}
