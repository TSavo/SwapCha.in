import Link from "next/link";
import { SwapTabs } from "@/components/SwapTabs";
import { formatUsd } from "@/lib/amount";
import {
  CHAIN_LABEL,
  explorerUrl,
  type TrendMarket,
  type TrendToken,
  trendFaq,
  trendSlugs,
} from "@/lib/trending";

const price = (n: number | null) =>
  n === null
    ? "—"
    : n >= 1
      ? formatUsd(n)
      : `$${n.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;

export function trendTitle(t: TrendToken, input: string) {
  return `How to buy ${t.name} (${t.symbol}) with ${input} on ${CHAIN_LABEL[t.chain]}`;
}

export function TrendingRoute({
  token: t,
  market: m,
  input,
}: {
  token: TrendToken;
  market: TrendMarket | null;
  input: { symbol: string; address: string; amount: string };
}) {
  const qa = trendFaq(t, input.symbol);
  const ld = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map((x) => ({
      "@type": "Question",
      name: x.q,
      acceptedAnswer: { "@type": "Answer", text: x.a },
    })),
  };
  const other = trendSlugs(t).filter((s) => !s.startsWith(`${input.symbol.toLowerCase()}-`));
  return (
    <article className="w-full" data-testid="trending-route-page">
      <script type="application/ld+json">{JSON.stringify(ld)}</script>
      <nav className="mb-3 text-sm font-bold text-violet-300">
        <Link href="/swap" className="hover:text-amber-300">
          Swap routes
        </Link>
        {" · "}
        <Link href="/scanner" className="hover:text-amber-300">
          Scanner
        </Link>
      </nav>
      <header className="mb-5 flex flex-col items-center gap-3 text-center">
        {t.imageUrl && (
          <img
            src={t.imageUrl}
            alt={t.symbol}
            width={72}
            height={72}
            className="h-18 w-18 rounded-full"
          />
        )}
        <h1 className="text-2xl font-black md:text-4xl">{trendTitle(t, input.symbol)}</h1>
        <p className="text-violet-200">
          {m?.priceUsd != null
            ? `${t.symbol} is ${price(m.priceUsd)} right now${m.priceChange24hPct != null ? ` (${m.priceChange24hPct > 0 ? "+" : ""}${m.priceChange24hPct.toFixed(1)}% in 24h)` : ""}. Swap below at the best live price across every aggregator.`
            : "Swap below at the best live price across every aggregator."}
        </p>
      </header>
      <div className="flex w-full flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
        <SwapTabs
          initial={{
            fromChain: t.chainId,
            toChain: t.chainId,
            fromToken: input.address,
            toToken: t.address,
            amount: input.amount,
          }}
        />
        <div className="flex w-full max-w-lg flex-col gap-4 lg:w-96">
          <section
            className="rounded-2xl border-2 border-violet-700 bg-violet-950 p-4 text-sm"
            data-testid="token-facts"
          >
            <h2 className="mb-2 font-black">
              {t.name} ({t.symbol})
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-violet-300">Chain</dt>
              <dd>{CHAIN_LABEL[t.chain]}</dd>
              <dt className="text-violet-300">Contract</dt>
              <dd className="break-all font-mono text-xs">
                <a
                  href={explorerUrl(t)}
                  target="_blank"
                  rel="noopener nofollow"
                  className="underline"
                >
                  {t.address}
                </a>
              </dd>
              <dt className="text-violet-300">Price</dt>
              <dd>{price(m?.priceUsd ?? null)}</dd>
              <dt className="text-violet-300">Liquidity</dt>
              <dd>{formatUsd(m?.liquidityUsd ?? null)}</dd>
              <dt className="text-violet-300">24h volume</dt>
              <dd>{formatUsd(m?.volume24hUsd ?? null)}</dd>
              <dt className="text-violet-300">FDV</dt>
              <dd>{formatUsd(m?.fdvUsd ?? null)}</dd>
            </dl>
            <p className="mt-2 text-xs text-violet-300">
              {m
                ? `Live from DexScreener${m.dex ? ` (deepest pool on ${m.dex})` : ""}, ${new Date(m.fetchedAt).toUTCString()}.`
                : "Market data is unavailable right now; the swap card has the live quote."}
            </p>
          </section>
          <section
            className="rounded-2xl border-2 border-violet-700 bg-violet-950 p-4 text-sm"
            data-testid="risk-summary"
          >
            <h2 className="mb-2 font-black">
              Risk check:{" "}
              <span className={t.riskLevel === "low" ? "text-emerald-300" : "text-amber-300"}>
                {t.riskLevel}
              </span>
            </h2>
            {t.riskFlags.length > 0 ? (
              <ul className="list-disc pl-5">
                {t.riskFlags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              <p>No flags raised by the automated checks.</p>
            )}
            <p className="mt-2 text-xs text-violet-300">
              Checked {new Date(t.firstSeen).toISOString().slice(0, 10)} with{" "}
              {t.chain === "solana" ? "RugCheck and Jupiter" : "GoPlus"}. Automated heuristics, not
              financial advice.
            </p>
          </section>
        </div>
      </div>
      <section className="mx-auto mt-8 max-w-3xl">
        <h2 className="mb-3 text-xl font-black">FAQ</h2>
        {qa.map((x) => (
          <details
            key={x.q}
            className="mb-2 rounded-xl border-2 border-violet-700 bg-violet-950 p-3"
          >
            <summary className="cursor-pointer font-bold">{x.q}</summary>
            <p className="mt-2 break-words text-sm text-violet-100">{x.a}</p>
          </details>
        ))}
        <p className="mt-3 text-sm text-violet-300">
          {other.map((s) => (
            <Link key={s} href={`/swap/${s}`} className="mr-3 underline">
              {s.split("-to-")[0]!.toUpperCase()} to {t.symbol}
            </Link>
          ))}
          <Link href="/swap" className="underline">
            All swap routes
          </Link>
        </p>
      </section>
    </article>
  );
}
