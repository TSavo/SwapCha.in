import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { SwapTabs } from "@/components/SwapTabs";
import { type Intel, initialFrom } from "@/lib/intel";
import { TOOLS, type ToolInfo } from "@/lib/toolList";
import { DataView } from "./DataView";

const SITE = "https://swapchan.com";

/** Every free tool page: live result + swap card above the fold, agent section, related tools, JSON-LD. */
export function ToolFrame({
  info,
  h1,
  intro,
  path,
  data,
  form,
  children,
  example,
}: {
  info: ToolInfo;
  h1: string;
  intro: string;
  path: string;
  data?: Intel | null;
  form?: React.ReactNode;
  children?: React.ReactNode;
  example?: string;
}) {
  const next = data?.next;
  const init = initialFrom(next?.swapUrl);
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: `${info.name} | SwapChan`,
      url: `${SITE}${path}`,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: intro,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "DeFi tools", item: `${SITE}/tools` },
        { "@type": "ListItem", position: 2, name: info.name, item: `${SITE}${path}` },
      ],
    },
  ];
  const sample =
    example ??
    (data && !data.error
      ? JSON.stringify(
          data,
          (k, v) => (k === "series" || k === "history30d" ? undefined : v),
          2,
        ).slice(0, 700)
      : undefined);
  return (
    <article className="w-full" data-testid="tool-page">
      <script type="application/ld+json">{JSON.stringify(ld)}</script>
      <h1 className="text-2xl font-black md:text-3xl">{h1}</h1>
      <p className="mb-4 text-sm text-violet-200 md:text-base">{intro}</p>
      <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-start">
        <div className="order-2 flex min-w-0 flex-1 flex-col gap-4 lg:order-1">
          {form}
          {next && (
            <a
              href={next.swapUrl}
              data-testid="swap-cta"
              className="block rounded-2xl border-2 border-violet-950 bg-amber-400 px-5 py-3 text-center text-lg font-black text-violet-950 shadow-[0_4px_0_#2e1065] hover:bg-amber-300"
            >
              {next.label} →
            </a>
          )}
          {data?.error && (
            <p className="rounded-xl border-2 border-rose-400 bg-rose-950/60 px-4 py-3 text-sm">
              {String(data.error)}
            </p>
          )}
          {children}
          {data && !data.error && !children && <DataView data={data} />}
        </div>
        <div className="order-1 w-full shrink-0 lg:order-2 lg:w-[26rem]">
          <SwapTabs {...(init ? { initial: init } : {})} />
        </div>
      </div>

      <section className="mt-10 rounded-3xl border border-fuchsia-400/40 bg-gradient-to-br from-violet-900 to-fuchsia-900/70 p-6">
        <h2 className="text-2xl font-black">Ask your AI agent instead</h2>
        <p className="mt-1 text-violet-200">
          This page is the{" "}
          <code className="rounded bg-violet-950 px-1.5 py-0.5 text-amber-300">{info.mcp}</code>{" "}
          tool in the SwapChan MCP server. Every answer ends with a ready-to-sign swap link.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-bold text-violet-300">You say</p>
            <p className="rounded-xl border-2 border-violet-600 bg-violet-950 px-4 py-3">
              “{info.prompt}”
            </p>
          </div>
          {sample && (
            <div className="min-w-0">
              <p className="mb-1 text-xs font-bold text-violet-300">Your agent gets ({info.mcp})</p>
              <pre className="max-h-56 overflow-auto rounded-xl border-2 border-violet-600 bg-violet-950 px-4 py-3 text-xs">
                {sample}
              </pre>
            </div>
          )}
        </div>
        <div className="mt-5">
          <AgentCTAs />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-xl font-black">More DeFi tools</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.filter((t) => t.mcp !== info.mcp).map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                className="block h-full rounded-xl border-2 border-violet-700 bg-violet-950 px-3 py-2 text-sm hover:border-amber-300"
              >
                <b>
                  {t.emoji} {t.name}
                </b>
                <span className="block text-xs text-violet-300">{t.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
