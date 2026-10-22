import {
  type Chain,
  NATIVE_TOKEN,
  type Quote,
  type QuoteRequest,
  type QuotesResponse,
  type StatusResponse,
  SUPPORTED_CHAINS,
  type Token,
  type TxRequest,
  tokenList,
} from "@swapchan/shared";
import { formatUnits, parseUnits, toHex } from "viem";

const NATIVE_SYMBOL: Record<number, string> = { 137: "POL" };

const PRICES: Record<string, number> = {
  ETH: 3200,
  WETH: 3200,
  POL: 0.45,
  MATIC: 0.45,
  WBTC: 95000,
  LINK: 15,
  UNI: 9,
  AAVE: 250,
  ARB: 0.6,
  OP: 1.5,
  DAI: 1,
  USDC: 1,
  USDT: 1,
  GUSD: 1,
  CRV: 0.8,
  MKR: 1800,
  SHIB: 0.00002,
};

export const mockChains = (): Chain[] =>
  Object.entries(SUPPORTED_CHAINS).map(([id, c]) => ({ id: Number(id), ...c }));

const nativeToken = (chainId: number): Token => {
  const sym = NATIVE_SYMBOL[chainId] ?? "ETH";
  return {
    chainId,
    address: NATIVE_TOKEN,
    symbol: sym,
    name: sym === "ETH" ? "Ether" : "Polygon Ecosystem Token",
    decimals: 18,
  };
};

/** USDC on L2s, since the shared list only covers mainnet for now. */
const USDC: Record<number, `0x${string}`> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
};

export const mockTokens = (chainId?: number): Token[] => {
  const ids = chainId ? [chainId] : mockChains().map((c) => c.id);
  return ids.flatMap((id) => {
    const listed = tokenList.filter((t) => t.chainId === id);
    const usdc = USDC[id];
    const extra: Token[] =
      usdc && !listed.some((t) => t.symbol === "USDC")
        ? [{ chainId: id, address: usdc, symbol: "USDC", name: "USD Coin", decimals: 6 }]
        : [];
    return [nativeToken(id), ...listed, ...extra];
  });
};

const findToken = (chainId: number, address: string): Token | undefined =>
  mockTokens(chainId).find((t) => t.address.toLowerCase() === address.toLowerCase());

const priceOf = (t: Token | undefined): number => (t ? (PRICES[t.symbol] ?? 1) : 1);

const PROVIDERS_SAME = [
  { provider: "0x", edge: 1.0, gas: 2.1, eta: 15 },
  { provider: "cow", edge: 1.0015, gas: 0, eta: 60 },
  { provider: "velora", edge: 0.998, gas: 2.4, eta: 15 },
];
const PROVIDERS_CROSS = [
  { provider: "across", edge: 0.999, gas: 1.2, eta: 8 },
  { provider: "relay", edge: 0.9985, gas: 0.9, eta: 12 },
  { provider: "lifi", edge: 0.997, gas: 1.8, eta: 120 },
];

export const MOCK_SPENDER = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const; // Permit2

export const mockQuotes = (req: QuoteRequest): QuotesResponse => {
  const from = findToken(req.fromChainId, req.fromToken);
  const to = findToken(req.toChainId, req.toToken);
  if (!from || !to)
    return { quotes: [], best: null, errors: [{ provider: "mock", message: "unknown token" }] };
  const cross = req.fromChainId !== req.toChainId;
  const inUsd = Number(formatUnits(BigInt(req.amount), from.decimals)) * priceOf(from);
  const isNative = from.address.toLowerCase() === NATIVE_TOKEN.toLowerCase();
  const quotes: Quote[] = (cross ? PROVIDERS_CROSS : PROVIDERS_SAME).map((p, i) => {
    const feeUsd = inUsd * 0.001;
    const outUsd = inUsd * p.edge - feeUsd;
    const outTokens = Math.max(outUsd / priceOf(to), 0);
    const toAmount = parseUnits(outTokens.toFixed(Math.min(to.decimals, 12)), to.decimals);
    const toAmountMin = (toAmount * BigInt(10_000 - req.slippageBps)) / 10_000n;
    const gasUsd = p.gas * (req.fromChainId === 1 ? 4 : 0.05);
    const steps: Quote["steps"] = cross
      ? [
          {
            type: "bridge",
            tool: p.provider,
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: from.address,
            toToken: to.address,
            fromAmount: req.amount,
            toAmount: toAmount.toString(),
          },
        ]
      : [
          {
            type: "swap",
            tool: p.provider,
            fromChainId: req.fromChainId,
            toChainId: req.toChainId,
            fromToken: from.address,
            toToken: to.address,
            fromAmount: req.amount,
            toAmount: toAmount.toString(),
          },
        ];
    return {
      id: `mock-${p.provider}-${i}-${Date.now()}`,
      provider: p.provider,
      request: req,
      toAmount: toAmount.toString(),
      toAmountMin: toAmountMin.toString(),
      gasUsd,
      feeUsd,
      netUsd: outUsd - gasUsd,
      etaSeconds: p.eta,
      steps,
      approvalAddress: isNative ? null : MOCK_SPENDER,
      tx: null,
      expiresAt: Date.now() + 60_000,
    };
  });
  quotes.sort((a, b) => (b.netUsd ?? 0) - (a.netUsd ?? 0));
  return { quotes, best: quotes[0]?.id ?? null, errors: [] };
};

export const mockBuild = (quoteId: string, chainId: number): TxRequest => ({
  chainId,
  to: "0x0000000000000000000000000000000000005a9c",
  data: toHex(quoteId) as `0x${string}`,
  value: "0",
});

const started = new Map<string, number>();
export const mockStatus = (txHash: string): StatusResponse => {
  const t0 = started.get(txHash) ?? Date.now();
  started.set(txHash, t0);
  return Date.now() - t0 > 8000
    ? { status: "done", receivingTxHash: `0x${"ab".repeat(32)}` as `0x${string}` }
    : { status: "pending", receivingTxHash: null };
};
