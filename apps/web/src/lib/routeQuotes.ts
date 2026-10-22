import { QuotesResponse, toBaseUnits, vmOf } from "@swapchan/shared";
import type { SeoRoute } from "./routes";

const API =
  process.env.SWAPCHAN_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
// Sample-quote addresses (quoting only, nothing is sent): one per VM, so cross-VM routes can quote.
const SAMPLE: Record<string, string> = {
  evm: "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B",
  svm: "BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE",
  bvm: "bc1qy65xajxwrtp62uk3styn9py7m2k06cdj2wla6n",
  tvm: "TULPYGfQ8U44XkhiX3oa3BaXdNPu6M5U3Z",
};

/** Live quotes for a route's sample amount; cached 5 min (ISR) to respect provider limits. */
export async function routeQuotes(r: SeoRoute): Promise<QuotesResponse | null> {
  const qs = new URLSearchParams({
    fromChainId: String(r.fromChainId),
    toChainId: String(r.toChainId),
    fromToken: r.fromToken.address,
    toToken: r.toToken.address,
    amount: toBaseUnits(r.amount, r.fromToken.decimals).toString(),
    taker: SAMPLE[vmOf(r.fromChainId)] ?? SAMPLE.evm!,
    recipient: SAMPLE[vmOf(r.toChainId)] ?? SAMPLE.evm!,
  });
  try {
    const res = await fetch(`${API}/quotes?${qs}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(12_000),
    });
    return res.ok ? QuotesResponse.parse(await res.json()) : null;
  } catch {
    return null;
  }
}
