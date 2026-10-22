import type { TypedData } from "@swapchan/shared";
import { API_URL } from "./api";

export interface LimitOrder {
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
  viaSwapChan: boolean;
  explorer: string;
}
export interface LimitBuild {
  order: TypedData;
  appData: string;
  appDataHash: string;
  approvalAddress: `0x${string}`;
  partnerFee: { volumeBps: number; recipient: string } | null;
  market: { buyAmount: string } | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/limit${path}`, {
    ...init,
    ...(init?.body ? { headers: { "content-type": "application/json" } } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}
const qs = (o: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export const limitApi = {
  market: (p: { chainId: number; sellToken: string; buyToken: string; sellAmount: string }) =>
    call<{ buyAmount: string }>(`/market?${qs(p)}`),
  build: (p: {
    chainId: number;
    owner: string;
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    buyAmount: string;
    validTo: number;
  }) => call<LimitBuild>("/build", { method: "POST", body: JSON.stringify(p) }),
  submit: (p: {
    chainId: number;
    owner: string;
    order: Record<string, unknown>;
    signature: string;
  }) =>
    call<{ uid: string; explorer: string }>("/submit", { method: "POST", body: JSON.stringify(p) }),
  orders: (chainId: number, owner: string) =>
    call<LimitOrder[]>(`/orders?${qs({ chainId, owner })}`),
  cancelData: (chainId: number, uid: string) => call<TypedData>(`/cancel?${qs({ chainId, uid })}`),
  cancel: (p: { chainId: number; orderUids: string[]; signature: string }) =>
    call<{ cancelled: string[] }>("/cancel", { method: "POST", body: JSON.stringify(p) }),
};

/** buyAmount (base units) for `sell` at `price` (buy per 1 sell, decimal string). Exact integer math. */
export function buyForPrice(
  sell: bigint,
  sellDec: number,
  buyDec: number,
  price: string,
): bigint | null {
  if (!/^\d*\.?\d+$|^\d+\.$/.test(price)) return null;
  const [i = "0", f = ""] = price.split(".");
  const scale = 10n ** BigInt(f.length);
  const p = BigInt(i || "0") * scale + BigInt(f || "0");
  return (sell * p * 10n ** BigInt(buyDec)) / (scale * 10n ** BigInt(sellDec));
}
/** Price (buy per 1 sell) as a decimal string with `sig` significant-ish digits. */
export function priceOf(sell: bigint, sellDec: number, buy: bigint, buyDec: number): string {
  if (sell === 0n) return "0";
  const n = Number(buy) / 10 ** buyDec / (Number(sell) / 10 ** sellDec);
  return n >= 1 ? n.toFixed(6).replace(/\.?0+$/, "") : n.toPrecision(6).replace(/\.?0+$/, "");
}
