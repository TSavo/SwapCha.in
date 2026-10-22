import {
  BuildResponse,
  type Chain,
  Chain as ChainSchema,
  type Quote,
  type QuoteRequest,
  QuotesResponse,
  type StatusRequest,
  StatusResponse,
  type Token,
  Token as TokenSchema,
} from "@swapchan/shared";
import { z } from "zod";

/** Error from the SwapChan HTTP API, carrying its status and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Thin typed client over the frozen HTTP contract in packages/shared/README.md. */
export class SwapChanApi {
  constructor(
    private readonly baseUrl: string,
    private readonly opts: {
      apiKey?: string | undefined;
      fetch?: FetchFn;
      timeoutMs?: number;
    } = {},
  ) {}

  private async req<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init?.body) headers["content-type"] = "application/json";
    if (this.opts.apiKey) headers["x-api-key"] = this.opts.apiKey;
    const f = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      });
    } catch (e) {
      throw new ApiError(502, `SwapChan API unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      throw new ApiError(502, `SwapChan API returned non-JSON (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const err = body as { error?: string; issues?: unknown } | undefined;
      throw new ApiError(res.status, err?.error ?? `HTTP ${res.status}`, err?.issues);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        502,
        `SwapChan API response failed contract validation: ${parsed.error.message}`,
      );
    return parsed.data;
  }

  chains(): Promise<Chain[]> {
    return this.req(z.array(ChainSchema), "/chains");
  }
  tokens(chainId?: number): Promise<Token[]> {
    return this.req(z.array(TokenSchema), chainId ? `/tokens?chainId=${chainId}` : "/tokens");
  }
  /** Any ERC-20 by address (on-chain metadata); null when it isn't a token on that chain. */
  async token(chainId: number, address: string): Promise<(Token & { verified: boolean }) | null> {
    try {
      return await this.req(
        TokenSchema.extend({ verified: z.boolean() }),
        `/token?chainId=${chainId}&address=${address}`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }
  quotes(r: QuoteRequest): Promise<QuotesResponse> {
    return this.req(QuotesResponse, `/quotes?${qs(r)}`);
  }
  build(quoteId: string, taker: string, recipient?: string): Promise<BuildResponse> {
    return this.req(BuildResponse, "/build", {
      method: "POST",
      body: JSON.stringify({ quoteId, taker, ...(recipient ? { recipient } : {}) }),
    });
  }
  status(r: StatusRequest): Promise<StatusResponse> {
    return this.req(StatusResponse, `/status?${qs(r)}`);
  }
}

const qs = (o: Record<string, unknown>): string =>
  new URLSearchParams(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export type { Quote };
