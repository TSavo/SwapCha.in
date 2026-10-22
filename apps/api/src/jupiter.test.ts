import type { QuoteRequest } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import type { Pricer } from "./pricing.js";
import { jupiter, WSOL } from "./providers/jupiter.js";
import { clearScannerCache, quickRisk, scannerRoutes } from "./scanner.js";

const SOL = 792703809;
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const FEE_WALLET = "BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE";
const pricer: Pricer = {
  token: async (_c, a) => ({ priceUsd: a === BONK ? 0.00003 : 200, decimals: a === BONK ? 5 : 9 }),
  usd: async (_c, a, amt) =>
    (Number(amt) / (a === BONK ? 1e5 : 1e9)) * (a === BONK ? 0.00003 : 200),
};
const req = {
  fromChainId: SOL,
  toChainId: SOL,
  fromToken: "11111111111111111111111111111111",
  toToken: BONK,
  amount: "100000000",
  slippageBps: 50,
} as QuoteRequest;
const ix = (programId: string) => ({
  programId,
  accounts: [{ pubkey: FEE_WALLET, isSigner: true, isWritable: true }],
  data: "AQ==",
});
const build = {
  inAmount: "100000000",
  outAmount: "66600000000",
  otherAmountThreshold: "66200000000",
  routePlan: [{ swapInfo: { label: "Whirlpool" } }],
  computeBudgetInstructions: [
    {
      programId: "ComputeBudget111111111111111111111111111111",
      accounts: [],
      data: "AxAnAAAAAAAA",
    },
  ],
  setupInstructions: [ix("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")],
  swapInstruction: ix("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
  cleanupInstruction: null,
  otherInstructions: [],
  tipInstruction: null,
  addressesByLookupTableAddress: { ALT1: ["x"] },
};
const fetchCapture = () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    return Response.json(build);
  }) as unknown as typeof fetch;
  return { f, urls };
};

describe("jupiter", () => {
  const env = { SWAPCHAN_FEE_BPS: "10", SWAPCHAN_FEE_RECIPIENT_SOLANA: FEE_WALLET };

  it("only Solana same-chain", () => {
    const j = jupiter(pricer, env, fetch, async () => new Map());
    expect(j.supports(req)).toBe(true);
    expect(j.supports({ ...req, toChainId: 8453 })).toBe(false);
  });

  it("charges our fee into the fee wallet's output-mint account when it exists", async () => {
    const { f, urls } = fetchCapture();
    const j = jupiter(
      pricer,
      env,
      f,
      async () => new Map([[BONK, "FeeBonkAta111111111111111111111111111111111"]]),
    );
    const q = await j.quote(
      { ...req, taker: FEE_WALLET as `0x${string}` },
      AbortSignal.timeout(1000),
    );
    const u = new URL(urls[0] ?? "");
    expect(u.pathname).toBe("/swap/v2/build");
    expect(u.searchParams.get("inputMint")).toBe(WSOL);
    expect(u.searchParams.get("platformFeeBps")).toBe("10");
    expect(u.searchParams.get("feeAccount")).toBe("FeeBonkAta111111111111111111111111111111111");
    expect(q.ourFeeVerified).toBe(true);
    expect(q.ourFeeUsd).toBeCloseTo((666000 * 0.00003 * 10) / 9990, 6);
    expect(q.feeRecipient).toEqual({ address: FEE_WALLET, chainId: SOL });
    expect(q.execution).toBe("nonevm");
    const d = q.nonEvmTx?.data as {
      instructions: { programId: string; data: string }[];
      addressLookupTableAddresses: string[];
    };
    expect(d.instructions[0]?.programId).toBe("ComputeBudget111111111111111111111111111111");
    expect(d.instructions.at(-1)?.data).toBe("01");
    expect(d.addressLookupTableAddresses).toEqual(["ALT1"]);
  });

  it("goes fee-less (unverified) when the fee wallet has no account for the output mint", async () => {
    const { f, urls } = fetchCapture();
    const j = jupiter(pricer, env, f, async () => new Map([[WSOL, "x"]]));
    const q = await j.quote(req, AbortSignal.timeout(1000));
    expect(new URL(urls[0] ?? "").searchParams.get("platformFeeBps")).toBeNull();
    expect(q.ourFeeVerified).toBe(false);
    expect(q.ourFeeUsd).toBe(0);
    expect(q.nonEvmTx).toBeUndefined();
  });
});

describe("scanner", () => {
  it("quick risk flags thin, brand-new, mintable tokens", () => {
    const r = quickRisk(
      {
        chain: "solana",
        chainId: SOL,
        address: BONK,
        symbol: "X",
        name: "X",
        imageUrl: null,
        priceUsd: 1,
        liquidityUsd: 2000,
        fdvUsd: 1e6,
        volumeUsd: {},
        priceChangePct: {},
        pairCreatedAt: null,
        ageHours: 0.2,
        dex: null,
        pairUrl: null,
      },
      { mintAuthorityDisabled: false, freezeAuthorityDisabled: false },
    );
    expect(r.level).toBe("high");
    expect(r.flags).toContain("freeze authority enabled");
  });

  it("/scanner/new merges GeckoTerminal pools and caches upstream calls", async () => {
    clearScannerCache();
    const calls: string[] = [];
    const now = new Date(Date.now() - 30 * 60_000).toISOString();
    const f = (async (u: string) => {
      calls.push(u);
      if (u.includes("geckoterminal"))
        return Response.json({
          data: [
            {
              attributes: {
                name: "NEW / SOL",
                pool_created_at: now,
                reserve_in_usd: "20000",
                volume_usd: { h24: "5000" },
                price_change_percentage: { h1: "40" },
                base_token_price_usd: "0.01",
                address: "pool1",
              },
              relationships: {
                base_token: { data: { id: "solana_Mint1111111111111111111111111111111111" } },
              },
            },
          ],
          included: [
            {
              id: "solana_Mint1111111111111111111111111111111111",
              attributes: {
                address: "Mint1111111111111111111111111111111111",
                name: "New",
                symbol: "NEW",
              },
            },
          ],
        });
      return Response.json([]);
    }) as unknown as typeof fetch;
    const app = scannerRoutes(f, {});
    const r = await (await app.request("/new?chain=solana")).json();
    expect(r.tokens[0].symbol).toBe("NEW");
    expect(r.tokens[0].risk.flags).toContain("under 1 hour old");
    expect(r.tokens[0].swapUrl).toContain("toToken=Mint1111111111111111111111111111111111");
    expect(r.disclaimer).toMatch(/financial advice/);
    const n = calls.length;
    await app.request("/new?chain=solana");
    expect(calls.length).toBe(n);
  });
});
