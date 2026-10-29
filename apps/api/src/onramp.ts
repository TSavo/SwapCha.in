import { Hono } from "hono";
import { createHmac } from "node:crypto";

type F = typeof fetch;

/**
 * Card on-ramp via Crossmint. The server creates the order with the SERVER key (never the card data,
 * never the funds); the browser then mounts Crossmint's embedded checkout with the returned
 * clientSecret to take the card payment and KYC. Crossmint settles USDC straight to the user's own
 * wallet (`recipient.walletAddress`) — so SwapChan stays fully non-custodial.
 */
/** Crossmint API base. Staging lets us validate the whole flow before production is enabled. */
const apiBase = (env: NodeJS.ProcessEnv) =>
  env.CROSSMINT_ENV === "staging"
    ? "https://staging.crossmint.com/api/2022-06-09"
    : "https://www.crossmint.com/api/2022-06-09";

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
  base: string,
  args: { walletAddress: string; chainId: number; amountUsd: string; email: string },
): Promise<OnrampOrder> {
  const t = USDC[args.chainId];
  if (!t) throw new Error(`on-ramp not supported on chain ${args.chainId}`);
  const amount = String(args.amountUsd).trim();
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new Error("bad amount");
  const tokenLocator = `${t.chain}:${t.address}`;
  const body = JSON.stringify({
    lineItems: [{ tokenLocator, executionParameters: { mode: "exact-in", amount } }],
    payment: { method: "card", receiptEmail: args.email },
    recipient: { walletAddress: args.walletAddress },
  });
  console.log(`[onramp] create order chain=${args.chainId} token=${tokenLocator} amount=${amount} base=${base}`);
  const r = await f(`${base}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": serverKey },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let j: {
    order?: { orderId?: string };
    clientSecret?: string;
    payment?: { status?: string };
    message?: string;
  } | null = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!r.ok || !j?.order?.orderId || !j?.clientSecret) {
    console.error(`[onramp] crossmint ${r.status}: ${text.slice(0, 400)}`);
    throw new Error(`crossmint order failed (${r.status}): ${j?.message ?? "no order/clientSecret"}`);
  }
  console.log(`[onramp] order ok ${j.order.orderId} status=${j.payment?.status}`);
  return {
    orderId: j.order.orderId,
    clientSecret: j.clientSecret,
    status: j.payment?.status,
    token: tokenLocator,
  };
}

/**
 * MoonPay hosted on-ramp. Unlike Crossmint (server creates an order, browser mounts an embedded
 * checkout), MoonPay is a single hosted widget: the server builds the buy-widget URL with the
 * PUBLISHABLE key as `apiKey`, then HMAC-SHA256-signs the query string with the SECRET key. Signing
 * is MANDATORY whenever `walletAddress` is in the URL (unsigned → the widget refuses to load). The
 * browser opens the signed URL; MoonPay takes the card + KYC and settles crypto straight to the
 * user's own wallet, so SwapChan stays non-custodial. We never see the card, the funds, or KYC data.
 *
 * Dormant until MOONPAY_SECRET_KEY + MOONPAY_PUBLISHABLE_KEY are set (then /onramp/moonpay/sign works);
 * keys determine the environment — sk_test_/pk_test_ hit the sandbox host, sk_live_/pk_live_ production.
 */
/** MoonPay buy-widget hosts we will sign a URL for (sandbox + production). */
const MOONPAY_HOSTS = new Set(["buy-sandbox.moonpay.com", "buy.moonpay.com"]);

/**
 * Sign a MoonPay widget URL produced by the browser SDK's generateUrlForSigning(). We HMAC the URL's
 * query string EXACTLY as the SDK built it (the canonical form MoonPay validates — mpSdk param and
 * all), matching MoonPay's own demo signer (`new URL(url).search`). A hand-built URL will not
 * validate, so this must be the SDK's output. We validate the host and that the URL carries our own
 * publishable apiKey, so we never sign an arbitrary third party's widget link with our secret.
 */
export function signMoonpayUrl(pubKey: string, secretKey: string, rawUrl: string): { signature: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("bad url");
  }
  if (!MOONPAY_HOSTS.has(u.hostname)) throw new Error(`unexpected host ${u.hostname}`);
  if (u.searchParams.get("apiKey") !== pubKey) throw new Error("apiKey does not match this environment");
  // Sign the query string including the leading "?", exactly as the SDK/widget sees it. Standard
  // base64 (not base64url); the SDK URL-encodes it when it appends &signature=.
  const signature = createHmac("sha256", secretKey).update(u.search).digest("base64");
  console.log(`[onramp] moonpay sign host=${u.hostname} currency=${u.searchParams.get("currencyCode")} amount=${u.searchParams.get("baseCurrencyAmount")}`);
  return { signature };
}

export function onrampRoutes(f: F, env: NodeJS.ProcessEnv) {
  const app = new Hono();
  app.post("/moonpay/sign", async (c) => {
    console.log(`[onramp] POST /moonpay/sign from origin=${c.req.header("origin") ?? "?"}`);
    const pubKey = env.MOONPAY_PUBLISHABLE_KEY;
    const secretKey = env.MOONPAY_SECRET_KEY;
    if (!pubKey || !secretKey) return c.json({ error: "on-ramp not configured" }, 503);
    let body: { url?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad JSON body" }, 400);
    }
    const url = body?.url;
    if (!url) return c.json({ error: "url is required" }, 400);
    try {
      return c.json(signMoonpayUrl(pubKey, secretKey, url));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "sign failed";
      console.error(`[onramp] moonpay sign failed: ${msg}`);
      return c.json({ error: msg }, 502);
    }
  });
  app.post("/order", async (c) => {
    console.log(`[onramp] POST /order from origin=${c.req.header("origin") ?? "?"}`);
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
        await createOnrampOrder(f, key, apiBase(env), { walletAddress, chainId, amountUsd, email }),
      );
    } catch (e) {
      // Pass Crossmint's real message through (e.g. "Onramp is not yet enabled for production"), so the
      // agent and the UI say what's actually wrong instead of a generic failure.
      const msg = e instanceof Error ? e.message : "order failed";
      console.error(`[onramp] order failed: ${msg}`);
      return c.json({ error: msg }, 502);
    }
  });
  return app;
}
