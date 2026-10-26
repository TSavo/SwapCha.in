import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DevToolForm } from "@/components/devtools/DevToolForm";
import { PoweredBy } from "@/components/devtools/PoweredBy";
import { CHAIN_PAGES, chainHref, chainLd, chainPage } from "@/lib/chainPages";
import { DEV_TOOLS, devTool } from "@/lib/devTools";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return CHAIN_PAGES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = chainPage((await params).slug);
  if (!c) return {};
  return {
    title: c.pageTitle,
    description: c.description,
    keywords: [`${c.title} address validator`, `${c.ticker} address format`],
    alternates: { canonical: chainHref(c) },
    openGraph: { title: c.pageTitle, description: c.description, url: chainHref(c) },
  };
}

export default async function Page({ params }: Props) {
  const c = chainPage((await params).slug);
  const validator = devTool("validate-address");
  if (!c || !validator) notFound();
  const related = c.related.map((s) => DEV_TOOLS.find((t) => t.slug === s)).filter((t) => !!t);
  return (
    <article className="w-full" data-testid="chain-page">
      <script type="application/ld+json">{JSON.stringify(chainLd(c))}</script>
      <nav className="mb-1 text-xs font-bold text-violet-300 md:text-sm">
        <Link href="/tools" className="hover:text-amber-300">
          Free tools
        </Link>
        {" · "}
        <Link href="/chains" className="hover:text-amber-300">
          Chains
        </Link>
        {` · ${c.title}`}
      </nav>
      <h1 className="text-2xl font-black md:text-3xl">{c.h1}</h1>
      <p className="mb-4 text-sm text-violet-200 md:text-base">{c.intro}</p>
      <DevToolForm
        tool={{
          ...validator,
          modes: validator.modes.filter((m) => m.id === "validate"),
          examples: c.examples.map((e) => ({
            label: `${c.ticker} ${e.kind.toUpperCase()} example`,
            mode: "validate",
            values: { address: e.address, chain: c.name },
          })),
        }}
        initial={{ mode: "validate", values: { chain: c.name } }}
      />
      <section className="mt-8">
        <h2 className="mb-3 text-xl font-black">{c.ticker} address format</h2>
        <dl className="space-y-2">
          {c.formats.map((f) => (
            <div key={f.label}>
              <dt className="font-bold">{f.label}</dt>
              <dd className="text-violet-200">{f.detail}</dd>
            </div>
          ))}
        </dl>
        {c.examples.length > 0 && (
          <>
            <h3 className="mt-4 font-bold">Public examples</h3>
            <ul className="space-y-1 text-sm">
              {c.examples.map((e) => (
                <li key={e.address}>
                  <code className="break-all">{e.address}</code>{" "}
                  <span className="text-violet-400">({e.kind.toUpperCase()})</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="mt-8 space-y-2 text-violet-100">
        <h2 className="text-xl font-black">Good to know</h2>
        {c.notes.map((n) => (
          <p key={n.slice(0, 40)}>{n}</p>
        ))}
        {c.lookAlikes.length > 0 && (
          <p>
            Look-alike chains:{" "}
            {c.lookAlikes.map((l, i) => (
              <span key={l.slug}>
                {i > 0 && ", "}
                <Link href={`/chains/${l.slug}`} className="underline hover:text-amber-300">
                  {l.title}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
        {c.explorers.length > 0 && (
          <p>
            Public explorers:{" "}
            {c.explorers.map((e, i) => (
              <span key={e.name}>
                {i > 0 && ", "}
                <a
                  href={`https://${e.name}`}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline hover:text-amber-300"
                >
                  {e.name}
                </a>
              </span>
            ))}
            .
          </p>
        )}
        <p className="text-sm text-violet-300">
          This page checks address formats only. It never asks for a private key or seed phrase.
          Want to know if an address still holds funds? Try{" "}
          <Link href="/find-money" className="underline hover:text-amber-300">
            find money
          </Link>{" "}
          (coverage is listed there). Lost the wallet app? See{" "}
          <Link href="/recover" className="underline hover:text-amber-300">
            the recovery guides
          </Link>
          .
        </p>
      </section>
      <section className="mt-8">
        <h2 className="mb-3 text-xl font-black">FAQ</h2>
        <dl className="space-y-3">
          {c.faq.map((f) => (
            <div key={f.q}>
              <dt className="font-bold">{f.q}</dt>
              <dd className="text-violet-200">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="mt-8">
        <h2 className="mb-3 text-xl font-black">Related tools</h2>
        <ul className="flex flex-wrap gap-2">
          {related.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/tools/${r.slug}`}
                className="block rounded-full border border-violet-500 px-3 py-1 text-sm hover:border-amber-300"
              >
                {r.emoji} {r.name}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/chains"
              className="block rounded-full border border-violet-500 px-3 py-1 text-sm hover:border-amber-300"
            >
              All {CHAIN_PAGES.length} chains
            </Link>
          </li>
        </ul>
      </section>
      <footer className="mt-10 border-t border-violet-800 pt-4 text-xs text-violet-400">
        <PoweredBy />
      </footer>
    </article>
  );
}
