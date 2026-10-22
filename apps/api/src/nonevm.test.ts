import type { QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import type { Pricer } from "./pricing.js";
import { across } from "./providers/across.js";
import { cow } from "./providers/cow.js";
import { lifi } from "./providers/lifi.js";
import { relay } from "./providers/relay.js";
import { velora } from "./providers/velora.js";
import { zerox } from "./providers/zerox.js";

const SOL = 792703809;
const BTC = 8253038;
const SOL_NATIVE = "11111111111111111111111111111111";
const BTC_NATIVE = "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const EVM_FEE = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const SOL_ADDR = "BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE";
const sig = () => AbortSignal.timeout(1000);
const env = { SWAPCHAN_FEE_RECIPIENT: EVM_FEE, SWAPCHAN_FEE_BPS: "10" };
const capture = (body: unknown) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return Response.json(body);
  }) as unknown as typeof fetch;
  return { f, calls };
};
const toSol = {
  fromChainId: 8453,
  toChainId: SOL,
  fromToken: BASE_USDC,
  toToken: SOL_NATIVE,
  amount: "100000000",
  slippageBps: 50,
} as QuoteRequest;

describe("non-EVM chains", () => {
  it("EVM-only providers skip Solana/Bitcoin routes", () => {
    const p = {} as Pricer;
    for (const a of [across(p, fetch, {}), cow(p, fetch, {}), velora(p, {}), zerox({}, p)])
      expect(a.supports(toSol)).toBe(false);
  });

  it("relay: passes recipient, EVM app-fee recipient, reports fee recipient + svm payload", async () => {
    const { f, calls } = capture({
      requestId: "0xr",
      steps: [
        {
          id: "deposit",
          kind: "transaction",
          items: [
            { data: { instructions: [{ programId: "x" }], addressLookupTableAddresses: [] } },
          ],
        },
      ],
      fees: {
        app: { amount: "1000000", amountUsd: "0.1", currency: { chainId: SOL } },
        gas: { amount: "1", amountUsd: "0.001" },
      },
      details: { currencyOut: { amount: "100000000", amountUsd: "100" } },
    });
    const q = await relay(env, f).quote(
      {
        ...toSol,
        fromChainId: SOL,
        toChainId: 8453,
        fromToken: SOL_NATIVE,
        toToken: BASE_USDC,
        taker: SOL_ADDR,
        recipient: EVM_FEE,
      } as QuoteRequest,
      sig(),
    );
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.originCurrency).toBe(SOL_NATIVE);
    expect(body.user).toBe(SOL_ADDR);
    expect(body.recipient).toBe(EVM_FEE);
    expect(body.appFees[0].recipient).toBe(EVM_FEE);
    expect(q.ourFeeVerified).toBe(true);
    expect(q.feeRecipient).toEqual({ address: EVM_FEE, chainId: SOL });
    expect(q.tx).toBeNull();
    expect(q.execution).toBe("nonevm");
    expect(q.nonEvmTx?.kind).toBe("svm-instructions");
  });

  it("relay: indicative cross-VM quote gets a placeholder recipient", async () => {
    const { f, calls } = capture({
      steps: [],
      fees: {},
      details: { currencyOut: { amount: "1" } },
    });
    await relay(env, f).quote(toSol, sig());
    expect(JSON.parse(String(calls[0]?.init?.body)).recipient).toMatch(
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    );
  });

  it("lifi: maps Solana/Bitcoin chain ids and bitcoin token, back again in steps", async () => {
    const step = {
      id: "s",
      type: "lifi",
      tool: "near",
      action: {
        fromChainId: 1,
        toChainId: 20000000000001,
        fromToken: { address: "0x0000000000000000000000000000000000000000" },
        toToken: { address: "bitcoin" },
        fromAmount: "1",
      },
      estimate: { toAmount: "293000", toAmountMin: "290000", executionDuration: 600 },
    };
    const { f, calls } = capture(step);
    const q = await lifi(env, f).quote(
      {
        fromChainId: 1,
        toChainId: BTC,
        fromToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        toToken: BTC_NATIVE,
        amount: "1",
        slippageBps: 50,
        recipient: "bc1qy65xajxwrtp62uk3styn9py7m2k06cdj2wla6n",
      } as QuoteRequest,
      sig(),
    );
    const u = new URL(calls[0]?.url ?? "");
    expect(u.searchParams.get("toChain")).toBe("20000000000001");
    expect(u.searchParams.get("toToken")).toBe("bitcoin");
    expect(u.searchParams.get("toAddress")).toBe("bc1qy65xajxwrtp62uk3styn9py7m2k06cdj2wla6n");
    expect(q.steps[0]?.toChainId).toBe(BTC);
    expect(q.steps[0]?.toToken).toBe(BTC_NATIVE);
  });

  it("lifi: a rejected API key (401/1010) falls back to keyless", async () => {
    const seen: (string | undefined)[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      const k = (init?.headers as Record<string, string> | undefined)?.["x-lifi-api-key"];
      seen.push(k);
      return k
        ? new Response('{"message":"Unauthorized","code":1010}', { status: 401 })
        : Response.json({
            id: "s",
            type: "lifi",
            tool: "relay",
            action: {
              fromChainId: 8453,
              toChainId: 1151111081099710,
              fromToken: { address: BASE_USDC },
              toToken: { address: SOL_NATIVE },
              fromAmount: "1",
            },
            estimate: { toAmount: "5", toAmountMin: "4", executionDuration: 12.5 },
          });
    }) as unknown as typeof fetch;
    const q = await lifi({ ...env, LIFI_API_KEY: "bad" }, f).quote(toSol, sig());
    expect(seen).toEqual(["bad", undefined]);
    expect(q.toAmount).toBe("5");
  });

  it("relay: fractional time estimates round to whole seconds", async () => {
    const { f } = capture({
      steps: [],
      fees: {},
      details: { currencyOut: { amount: "1" }, timeEstimate: 612.4 },
    });
    expect((await relay(env, f).quote(toSol, sig())).etaSeconds).toBe(612);
  });
});
