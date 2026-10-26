import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PoweredBy } from "@/components/devtools/PoweredBy";
import { BT_REPO } from "@/lib/blocktools.server";

const SITE = "https://swapchan.com";

export function btMeta(path: string, title: string, description: string): Metadata {
  return {
    title: `${title} | blocktools`,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} | blocktools`,
      description,
      url: `${SITE}${path}`,
      siteName: "SwapChan",
      type: "article",
    },
    twitter: { card: "summary", title: `${title} | blocktools`, description },
  };
}

export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json">{JSON.stringify(data)}</script>;
}

export function crumbLd(items: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, p], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE}${p}`,
    })),
  };
}

/** Shared frame for every /blocktools page: header, body, trust line and one credit. */
export function BtPage({
  title,
  lead,
  children,
  source,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  source?: string;
}) {
  return (
    <article className="mx-auto w-full max-w-4xl">
      <div className="mb-1 font-mono text-xs font-bold tracking-widest text-fuchsia-300 uppercase">
        blocktools CLI
      </div>
      <h1 className="text-3xl font-black md:text-4xl">{title}</h1>
      {lead && <div className="mt-2 mb-6 text-violet-200">{lead}</div>}
      {children}
      <footer className="mt-12 border-t border-violet-500/30 pt-4 text-xs text-violet-400">
        {source && (
          <p className="mb-1">
            Source:{" "}
            <a href={source} className="underline hover:text-amber-300" rel="noopener">
              {source.replace("https://github.com/", "")}
            </a>{" "}
            (MIT), copied at commit 657458a.
          </p>
        )}
        <p>
          blocktools is free and open source (MIT). It runs on your machine: SwapChan never holds
          your keys or funds and never signs for you.{" "}
          <Link href="/blocktools" className="underline hover:text-amber-300">
            blocktools home
          </Link>{" "}
          ·{" "}
          <a href={BT_REPO} className="underline hover:text-amber-300" rel="noopener">
            GitHub
          </a>{" "}
          · <PoweredBy />
        </p>
      </footer>
    </article>
  );
}
