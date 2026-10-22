import { fromBaseUnits, QuotesResponse, tokenList } from "@swapchan/shared";

const API =
  process.env.SWAPCHAN_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Server-rendered live route board (100 USDC Ethereum -> Base). Cached 60s to respect provider limits. */
export async function LiveRoutes() {
  const qs = new URLSearchParams({
    fromChainId: "1",
    toChainId: "8453",
    fromToken: USDC_ETH,
    toToken: USDC_BASE,
    amount: "100000000",
  });
  let data: QuotesResponse | null = null;
  try {
    const res = await fetch(`${API}/quotes?${qs}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) data = QuotesResponse.parse(await res.json());
  } catch {
    data = null;
  }
  const dec = tokenList.find((t) => t.address.toLowerCase() === USDC_ETH)?.decimals ?? 6;
  return (
    <section data-testid="live-routes" className="mt-8 rounded-2xl bg-violet-900/60 p-4">
      <h2 className="mb-2 font-bold">Live: 100 USDC Ethereum → Base</h2>
      {!data || data.quotes.length === 0 ? (
        <p className="text-violet-300">
          Swap-chan is catching her breath (no live routes right now).
        </p>
      ) : (
        <ul className="space-y-1 font-mono text-sm">
          {data.quotes.map((q) => (
            <li key={q.id} data-provider={q.provider}>
              {q.id === data.best ? "★ " : "  "}
              {q.provider}: {fromBaseUnits(q.toAmount, dec)} USDC
              {q.netUsd !== null ? ` (net $${q.netUsd.toFixed(2)})` : ""} · ~{q.etaSeconds}s
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
