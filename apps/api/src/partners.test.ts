import type { Quote, QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import { openPartnerStore } from "./partners.js";
import type { ProviderAdapter } from "./providers/types.js";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const LINK = "0x514910771af9ca656af840dff83e8264ecf986ca";
const PAYOUT = "0x1111111111111111111111111111111111111111";
const USER = "0x2222222222222222222222222222222222222222";
const quote = (verified: boolean): Quote => ({
  id: `kyber:${verified}`,
  provider: "kyberswap",
  request: {
    fromChainId: 1,
    toChainId: 1,
    fromToken: USDC,
    toToken: LINK,
    amount: "1000000",
    slippageBps: 50,
  } as QuoteRequest,
  toAmount: "100",
  toAmountMin: "100",
  gasUsd: 0,
  feeUsd: 0,
  netUsd: 1000,
  etaSeconds: 1,
  steps: [],
  approvalAddress: null,
  tx: null,
  expiresAt: 0,
  ourFeeUsd: 1,
  ourFeeVerified: verified,
});
const fake = (q: Quote): ProviderAdapter => ({
  name: q.provider,
  enabled: () => true,
  supports: () => true,
  quote: async () => q,
});
const qs = (extra: Record<string, string> = {}) =>
  `/quotes?${new URLSearchParams({ fromChainId: "1", toChainId: "1", fromToken: USDC, toToken: LINK, amount: "1000000", ...extra })}`;
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function setup(verified = true) {
  const partners = openPartnerStore(":memory:");
  const app = createApp([fake(quote(verified))], { pricer: null, simulator: null, partners });
  const res = await app.request(
    "/partners",
    json({ name: "Moon Project", siteUrl: "https://moon.example", evmAddress: PAYOUT }),
  );
  expect(res.status).toBe(201);
  const p = (await res.json()) as { id: string; token: string; dashboardUrl: string };
  return { app, p };
}

describe("partners", () => {
  it("registers, attributes quotes and swaps, and shows owed share", async () => {
    const { app, p } = await setup();
    expect(p.id).toMatch(/^moon-project-[0-9a-f]{6}$/);
    expect(p.dashboardUrl).toContain(`/partners/${p.id}#t=`); // fragment: not sent to servers/Referer
    const q = (await (await app.request(qs({ partner: p.id }))).json()) as { quotes: Quote[] };
    const id = q.quotes[0]?.id;
    const sw = await app.request(
      `/partners/${p.id}/swaps`,
      json({ quoteId: id, txHash: "0xabc12345", taker: USER }),
    );
    expect(await sw.json()).toMatchObject({ recorded: true, counted: true, partnerUsd: 0.5 });
    const dash = await (await app.request(`/partners/${p.id}?t=${p.token}`)).json();
    expect(dash).toMatchObject({
      quotes: 1,
      swaps: 1,
      countedSwaps: 1,
      feesUsd: 1,
      earnedUsd: 0.5,
      owedUsd: 0.5,
      volumeUsd: 1000,
    });
    // duplicate tx hash doesn't double count
    await app.request(
      `/partners/${p.id}/swaps`,
      json({ quoteId: id, txHash: "0xabc12345", taker: USER }),
    );
    expect((await (await app.request(`/partners/${p.id}?t=${p.token}`)).json()).swaps).toBe(1);
  });
  it("dashboard needs the token", async () => {
    const { app, p } = await setup();
    expect((await app.request(`/partners/${p.id}?t=wrong`)).status).toBe(404);
    expect((await app.request(`/partners/${p.id}/public`)).status).toBe(200);
  });
  it("no self-referral, no unverified fees, no unattributed quotes", async () => {
    const { app, p } = await setup();
    const q = (await (await app.request(qs({ partner: p.id }))).json()) as { quotes: Quote[] };
    const self = await app.request(
      `/partners/${p.id}/swaps`,
      json({ quoteId: q.quotes[0]?.id, txHash: "0xself0001", taker: PAYOUT }),
    );
    expect(await self.json()).toMatchObject({
      counted: false,
      reason: "self-referral",
      partnerUsd: 0,
    });
    const u = await setup(false);
    const uq = (await (await u.app.request(qs({ partner: u.p.id }))).json()) as { quotes: Quote[] };
    const r = await u.app.request(
      `/partners/${u.p.id}/swaps`,
      json({ quoteId: uq.quotes[0]?.id, txHash: "0xunver001" }),
    );
    expect(await r.json()).toMatchObject({ counted: false, reason: "no verified fee" });
    // a quote fetched without ?partner can't be claimed
    const plain = (await (await u.app.request(qs())).json()) as { quotes: Quote[] };
    expect(plain.quotes.length).toBe(1);
  });
  it("rejects bad signups", async () => {
    const { app } = await setup();
    const r = await app.request(
      "/partners",
      json({ name: "x", siteUrl: "ftp://a", evmAddress: "nope" }),
    );
    expect(r.status).toBe(400);
  });
});
