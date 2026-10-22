import {
  type Chain,
  Chain as ChainSchema,
  type Quote,
  type QuoteRequest,
  type QuotesResponse,
  QuotesResponse as QuotesResponseSchema,
  type StatusRequest,
  type StatusResponse,
  StatusResponse as StatusResponseSchema,
  type Token,
  Token as TokenSchema,
  type TxRequest,
  TxRequest as TxRequestSchema,
} from "@swapchan/shared";
import { z } from "zod";
import { mockBuild, mockChains, mockQuotes, mockStatus, mockTokens } from "./mock";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const FORCE_MOCK = process.env.NEXT_PUBLIC_MOCK_API === "1";

export interface ApiResult<T> {
  data: T;
  mocked: boolean;
}

class ApiError extends Error {}

const call = async <T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(msg);
  }
  return schema.parse(body);
};

/** Try the real API; on network failure (not API-level errors) fall back to mocks. */
const withMock = async <T>(real: () => Promise<T>, mock: () => T): Promise<ApiResult<T>> => {
  if (FORCE_MOCK) return { data: mock(), mocked: true };
  try {
    return { data: await real(), mocked: false };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return { data: mock(), mocked: true };
  }
};

export const toQuery = (o: Record<string, string | number | undefined>): string =>
  new URLSearchParams(
    Object.entries(o).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
  ).toString();

export const api = {
  chains: (): Promise<ApiResult<Chain[]>> =>
    withMock(() => call("/chains", z.array(ChainSchema)), mockChains),
  tokens: (chainId?: number): Promise<ApiResult<Token[]>> =>
    withMock(
      () => call(`/tokens?${toQuery({ chainId })}`, z.array(TokenSchema)),
      () => mockTokens(chainId),
    ),
  quotes: (req: QuoteRequest): Promise<ApiResult<QuotesResponse>> =>
    withMock(
      () => call(`/quotes?${toQuery({ ...req })}`, QuotesResponseSchema),
      () => mockQuotes(req),
    ),
  build: (quote: Quote, taker: `0x${string}`, mocked: boolean): Promise<TxRequest> =>
    mocked
      ? Promise.resolve(mockBuild(quote.id, quote.request.fromChainId))
      : call("/build", TxRequestSchema, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quoteId: quote.id, taker }),
        }),
  status: (req: StatusRequest, mocked: boolean): Promise<StatusResponse> =>
    mocked
      ? Promise.resolve(mockStatus(req.txHash))
      : call(`/status?${toQuery({ ...req })}`, StatusResponseSchema),
};
