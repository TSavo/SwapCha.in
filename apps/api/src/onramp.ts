import { Hono } from "hono";

type F = typeof fetch;

/**
 * Card on-ramp via Crossmint. The server creates the order with the SERVER key (never the card data,
 * never the funds); the browser then mounts Crossmint's embedded checkout with the returned
 * clientSecret to take the card payment and KYC. Crossmint settles USDC straight to the user's own
 * wallet (`recipient.walletAddress`) — so SwapChan stays fully non-custodial.
 */
const BASE = "https://www.crossmint.com/api/2022-06-09";

/** SwapChan chainId -> (Crossmint chain name, that chain's production USDC token address). */
const USDC: Record<number, { chain: string; address: string }> = {
  1: { chain: "ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  8453: { chain: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  42161: { chain: "arbitrum", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  10: { chain: "optimism", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  137: { chain: "polygon", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  792703809: { chain: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
};

export interface OnrampOrder {
  orderId: string;
  clientSecret: string;
  status?: string | undefined;
  token: string;
}

/** Create a Crossmint on-ramp order delivering USDC to `walletAddress` on `chainId`. */
export async function createOnrampOrder(
  f: F,
  serverKey: string,
  args: { walletAddress: string; chainId: number; amountUsd: string; email: string },
): Promise<OnrampOrder> {
  const t = USDC[args.chainId];
  if (!t) throw new Error(`on-ramp not supported on chain ${args.chainId}`);
  const amount = String(args.amountUsd).trim();
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new Error("bad amount");
  const tokenLocator = `${t.chain}:${t.address}`;
  const r = await f(`${BASE}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": serverKey },
    body: JSON.stringify({
      lineItems: [{ tokenLocator, executionParameters: { mode: "exact-in", amount } }],
      payment: { method: "card", receiptEmail: args.email },
      recipient: { walletAddress: args.walletAddress },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json().catch(() => null)) as {
    order?: { orderId?: string };
    clientSecret?: string;
    payment?: { status?: string };
    message?: string;
  } | null;
  if (!r.ok || !j?.order?.orderId || !j?.clientSecret) {
    throw new Error(`crossmint order failed (${r.status}): ${j?.message ?? "no order/clientSecret"}`);
  }
  return {
    orderId: j.order.orderId,
    clientSecret: j.clientSecret,
    status: j.payment?.status,
    token: tokenLocator,
  };
}

export function onrampRoutes(f: F, env: NodeJS.ProcessEnv) {
  const app = new Hono();
  app.post("/order", async (c) => {
    const key = env.CROSSMINT_SERVER_KEY;
    if (!key) return c.json({ error: "on-ramp not configured" }, 503);
    let body: { walletAddress?: string; chainId?: number; amountUsd?: string; email?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad JSON body" }, 400);
    }
    const { walletAddress, chainId, amountUsd, email } = body ?? {};
    if (!walletAddress || !chainId || !amountUsd || !email)
      return c.json({ error: "walletAddress, chainId, amountUsd, email are required" }, 400);
    try {
      return c.json(
        await createOnrampOrder(f, key, { walletAddress, chainId, amountUsd, email }),
      );
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "order failed" }, 502);
    }
  });
  return app;
}
