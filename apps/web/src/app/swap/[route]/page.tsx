import { fromBaseUnits } from "@swapchan/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SwapTabs } from "@/components/SwapTabs";
import { TrendingRoute, trendTitle } from "@/components/TrendingRoute";
import { formatEta, formatUsd } from "@/lib/amount";
import { castHref } from "@/lib/bios";
import { CHARACTERS, characterSrc } from "@/lib/characters";
import { routeQuotes } from "@/lib/routeQuotes";
import {
  blurb,
  chainKey,
  chainName,
  faq,
  providerName,
  ROUTES,
  related,
  routeBySlug,
  routeHref,
  title,
} from "@/lib/routes";
import { CHAIN_LABEL, inputFor, parseTrendSlug, trendingToken } from "@/lib/trending";

export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return []; // rendered on first hit, then cached (ISR): builds don't depend on live quotes
}

type Props = { params: Promise<{ route: string }> };

/** Trending-token page for slugs like sol-to-wif (created by the API's SEO job; never 404s once made). */
async function trend(slug: string) {
  const p = parseTrendSlug(slug);
  if (!p) return null;
  const d = await trendingToken(p.key);
  if (!d) return null;
  const input = inputFor(d.token, p.from);
  return input ? { ...d, input } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).route;
  const r = routeBySlug(slug);
  if (!r) {
    const tr = await trend(slug);
    if (!tr) return {};
    const t = trendTitle(tr.token, tr.input.symbol);
    const description = `Buy ${tr.token.name} (${tr.token.symbol}) on ${CHAIN_LABEL[tr.token.chain]} at the best live price across every aggregator. Contract ${tr.token.address}, live price and liquidity, risk check. Non-custodial.`;
    return {
      title: `${t} | SwapChan`,
      description,
      alternates: { canonical: `/swap/${slug}` },
      robots: tr.token.indexable ? undefined : { index: false, follow: true },
      openGraph: { title: t, description, url: `/swap/${slug}` },
      twitter: { card: "summary_large_image", title: t, description },
    };
  }
  const t = title(r);
  const description = `${t}: live quotes from ${r.providers.map(providerName).join(", ")} compared side by side. Best price after gas and fees, non-custodial, by SwapChan.`;
  return {
    title: `${t} | SwapChan`,
    description,
    alternates: { canonical: routeHref(r) },
    openGraph: { title: t, description, url: routeHref(r) },
    twitter: { card: "summary_large_image", title: t, description },
  };
}

export default async function RoutePage({ params }: Props) {
  const slug = (await params).route;
  const r = routeBySlug(slug);
  if (!r) {
    const tr = await trend(slug);
    if (!tr) notFound();
    return <TrendingRoute token={tr.token} market={tr.market} input={tr.input} />;
  }
  const q = await routeQuotes(r);
  const fk = chainKey(r.fromChainId);
  const tk = chainKey(r.toChainId);
  const best = q?.quotes[0];
  const qa = faq(r);
  const ld = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map((x) => ({
      "@type": "Question",
      name: x.q,
      acceptedAnswer: { "@type": "Answer", text: x.a },
    })),
  };
  const out = (a: string) =>
    Number(fromBaseUnits(a, r.toToken.decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  return (
    <article className="w-full" data-testid="route-page">
      <script type="application/ld+json">{JSON.stringify(ld)}</script>
      <nav className="mb-1 text-xs font-bold text-violet-300 md:text-sm">
        <Link href="/swap" className="hover:text-amber-300">
          Swap routes
        </Link>
        {r.fromChainId !== r.toChainId && (
          <>
            {" · "}
            <Link href="/bridge" className="hover:text-amber-300">
              Bridge routes
            </Link>
          </>
        )}
      </nav>
      <header className="mb-2 flex flex-col items-center gap-1 text-center md:mb-3 md:flex-row md:justify-center md:gap-3">
        <div className="hidden items-end gap-1 md:flex">
          {[fk, ...(tk !== fk ? [tk] : [])].map((k) => (
            <Link key={k} href={castHref(k)} title={`Meet ${CHARACTERS[k].name}`}>
              <img
                src={characterSrc(k)}
                alt={CHARACTERS[k].name}
                width={96}
                height={96}
                className="h-12 w-12"
              />
            </Link>
          ))}
        </div>
        <h1 className="text-xl font-black md:text-3xl">{title(r)}</h1>
        <p className="hidden text-sm text-violet-200 md:block">
          {best
            ? `Right now: ${r.amount} ${r.fromToken.symbol} gets you ${out(best.toAmount)} ${r.toToken.symbol} via ${providerName(best.provider)}.`
            : "Live quotes refresh every few minutes."}
        </p>
      </header>
      <div className="flex w-full flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
        <SwapTabs
          initial={{
            fromChain: r.fromChainId,
            toChain: r.toChainId,
            fromToken: r.fromToken.address,
            toToken: r.toToken.address,
            amount: r.amount,
          }}
        />
        <div className="flex w-full max-w-lg flex-col gap-4 lg:w-96">
          <section
            className="rounded-2xl border-2 border-violet-700 bg-violet-950 p-4"
            data-testid="provider-comparison"
          >
            <h2 className="mb-2 font-black">
              Provider comparison · {r.amount} {r.fromToken.symbol}
            </h2>
            {q && q.quotes.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-left text-violet-300">
                  <tr>
                    <th className="py-1">Provider</th>
                    <th>You get</th>
                    <th>Net</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {q.quotes.map((x, i) => (
                    <tr key={x.id} className={i === 0 ? "font-black text-amber-300" : ""}>
                      <td className="py-1">
                        {providerName(x.provider)}
                        {i === 0 ? " ★" : ""}
                      </td>
                      <td>
                        {out(x.toAmount)} {r.toToken.symbol}
                      </td>
                      <td>{formatUsd(x.netUsd)}</td>
                      <td>{formatEta(x.etaSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-violet-300">
                Providers are busy; the swap card has the live quote.
              </p>
            )}
          </section>
          <section className="rounded-2xl border-2 border-violet-700 bg-violet-950 p-4 text-sm leading-relaxed text-violet-100">
            {blurb(r).map((p) => (
              <p key={p} className="mb-2 last:mb-0">
                {p}
              </p>
            ))}
            <p className="mt-2">
              Meet{" "}
              <Link href={castHref(fk)} className="font-bold underline">
                {CHARACTERS[fk].name}
              </Link>
              {tk !== fk && (
                <>
                  {" "}
                  and{" "}
                  <Link href={castHref(tk)} className="font-bold underline">
                    {CHARACTERS[tk].name}
                  </Link>
                </>
              )}
              , the chans of {chainName(r.fromChainId)}
              {tk !== fk ? ` and ${chainName(r.toChainId)}` : ""}.
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
            <p className="mt-2 text-sm text-violet-100">{x.a}</p>
          </details>
        ))}
      </section>
      <section className="mx-auto mt-8 max-w-3xl">
        <h2 className="mb-3 text-xl font-black">Related routes</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {related(r).map((x) => (
            <li key={x.slug}>
              <Link
                href={routeHref(x)}
                className="block rounded-xl border-2 border-violet-700 bg-violet-950 px-3 py-2 text-sm font-bold hover:border-amber-300"
              >
                {title(x)}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-violet-300">
          <Link href="/swap" className="underline">
            All {ROUTES.length} routes
          </Link>
        </p>
      </section>
    </article>
  );
}
