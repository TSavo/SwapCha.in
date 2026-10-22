import {
  appDataHash,
  BaseUnits,
  COW_NETWORK,
  COW_VAULT_RELAYER,
  cancellationTypedData,
  cowApi,
  cowExplorer,
  EvmAddress,
  Hex,
  limitAppData,
  limitOrderTypedData,
  NATIVE_TOKEN,
} from "@swapchan/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Fetch } from "./providers/types.js";

const chainId = z.coerce
  .number()
  .int()
  .refine((c) => c in COW_NETWORK, "CoW limit orders are not supported on this chain");
const sellToken = EvmAddress.refine(
  (a) => a.toLowerCase() !== NATIVE_TOKEN.toLowerCase(),
  "CoW can't sell the native token: wrap it first",
);

export const LimitBuildRequest = z.object({
  chainId,
  owner: EvmAddress,
  sellToken,
  buyToken: EvmAddress,
  sellAmount: BaseUnits,
  buyAmount: BaseUnits,
  /** Unix seconds; default 7 days. Max 1 year. */
  validTo: z.coerce.number().int().optional(),
  partiallyFillable: z.boolean().optional(),
});

export interface CowOrder {
  uid: string;
  status: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  executedSellAmount: string;
  executedBuyAmount: string;
  validTo: number;
  creationDate: string;
  class: string;
  kind: string;
  fullAppData?: string | null;
}

async function cowJson<T>(f: Fetch, url: string, init?: RequestInit): Promise<T> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => null)) as T & {
    description?: string;
    errorType?: string;
  };
  if (!res.ok)
    throw new Error(`CoW: ${body?.description ?? body?.errorType ?? `HTTP ${res.status}`}`);
  return body;
}

/** CoW limit orders: build typed data (our partnerFee in appData), market reference, list, submit, cancel. */
export function limitRoutes(f: Fetch = fetch, env: NodeJS.ProcessEnv = process.env) {
  const bps = env.SWAPCHAN_FEE_RECIPIENT ? Number(env.SWAPCHAN_FEE_BPS ?? 0) : 0;
  const appData = limitAppData(env.SWAPCHAN_FEE_RECIPIENT, bps);
  const hash = appDataHash(appData);
  const uploaded = new Set<number>();
  const upload = async (c: number) => {
    if (uploaded.has(c)) return;
    await cowJson(f, `${cowApi(c)}/app_data/${hash}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullAppData: appData }),
    });
    uploaded.add(c);
  };
  /** Market reference: CoW's sell quote (net of our partner fee) for the same appData. */
  const market = async (c: number, sell: string, buy: string, amount: string, from: string) => {
    const r = await cowJson<{ quote: { buyAmount: string; feeAmount: string }; id?: number }>(
      f,
      `${cowApi(c)}/quote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sellToken: sell,
          buyToken: buy,
          from,
          kind: "sell",
          sellAmountBeforeFee: amount,
          appData,
          appDataHash: hash,
          priceQuality: "fast",
        }),
      },
    );
    const gross = BigInt(r.quote.buyAmount);
    return {
      buyAmount: ((gross * BigInt(10_000 - bps)) / 10_000n).toString(),
      feeAmount: r.quote.feeAmount,
    };
  };

  const app = new Hono();
  app.get("/market", async (c) => {
    const q = z
      .object({
        chainId,
        sellToken,
        buyToken: EvmAddress,
        sellAmount: BaseUnits,
        owner: EvmAddress.optional(),
      })
      .parse(c.req.query());
    const m = await market(
      q.chainId,
      q.sellToken,
      q.buyToken,
      q.sellAmount,
      q.owner ?? "0x0000000000000000000000000000000000000001",
    );
    return c.json({ ...m, sellAmount: q.sellAmount });
  });
  app.post("/build", async (c) => {
    const r = LimitBuildRequest.parse(await c.req.json());
    const now = Math.floor(Date.now() / 1000);
    const validTo = r.validTo ?? now + 7 * 86_400;
    if (validTo <= now + 60 || validTo > now + 366 * 86_400)
      return c.json({ error: "validTo must be between 1 minute and 1 year from now" }, 400);
    if (BigInt(r.sellAmount) === 0n || BigInt(r.buyAmount) === 0n)
      return c.json({ error: "amounts must be > 0" }, 400);
    await upload(r.chainId);
    const order = limitOrderTypedData({ ...r, validTo, appDataHash: hash });
    const ref = await market(r.chainId, r.sellToken, r.buyToken, r.sellAmount, r.owner).catch(
      () => null,
    );
    return c.json({
      order,
      appData,
      appDataHash: hash,
      partnerFee: bps > 0 ? { volumeBps: bps, recipient: env.SWAPCHAN_FEE_RECIPIENT } : null,
      approvalAddress: COW_VAULT_RELAYER,
      market: ref,
      submit: {
        url: `${cowApi(r.chainId)}/orders`,
        body: "{...order.message, signature, signingScheme: 'eip712', from: owner}",
      },
    });
  });
  app.get("/orders", async (c) => {
    const q = z.object({ chainId, owner: EvmAddress }).parse(c.req.query());
    const list = await cowJson<CowOrder[]>(
      f,
      `${cowApi(q.chainId)}/account/${q.owner}/orders?limit=50`,
    );
    return c.json(
      list
        .filter((o) => o.class === "limit")
        .map((o) => ({
          uid: o.uid,
          status: o.status,
          sellToken: o.sellToken,
          buyToken: o.buyToken,
          sellAmount: o.sellAmount,
          buyAmount: o.buyAmount,
          executedSellAmount: o.executedSellAmount,
          executedBuyAmount: o.executedBuyAmount,
          validTo: o.validTo,
          creationDate: o.creationDate,
          viaSwapChan: !!o.fullAppData?.includes('"SwapChan"'),
          explorer: cowExplorer(o.uid),
        })),
    );
  });
  app.post("/submit", async (c) => {
    const r = z
      .object({
        chainId,
        owner: EvmAddress,
        order: z.record(z.string(), z.unknown()),
        signature: Hex,
      })
      .parse(await c.req.json());
    if (String(r.order.appData).toLowerCase() !== hash.toLowerCase())
      return c.json({ error: "order appData is not SwapChan's" }, 400);
    const uid = await cowJson<string>(f, `${cowApi(r.chainId)}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...r.order,
        signature: r.signature,
        signingScheme: "eip712",
        from: r.owner,
      }),
    });
    return c.json({ uid, explorer: cowExplorer(uid) });
  });
  app.get("/cancel", (c) => {
    const q = z.object({ chainId, uid: Hex }).parse(c.req.query());
    return c.json(cancellationTypedData(q.chainId, [q.uid]));
  });
  app.post("/cancel", async (c) => {
    const r = z
      .object({ chainId, orderUids: z.array(Hex).min(1), signature: Hex })
      .parse(await c.req.json());
    await cowJson<unknown>(f, `${cowApi(r.chainId)}/orders`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderUids: r.orderUids,
        signature: r.signature,
        signingScheme: "eip712",
      }),
    });
    return c.json({ cancelled: r.orderUids });
  });
  return app;
}
