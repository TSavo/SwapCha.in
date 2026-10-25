import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevToolPage } from "@/components/devtools/DevToolPage";
import { DEV_TOOLS, devTool } from "@/lib/devTools";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return DEV_TOOLS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = devTool((await params).slug);
  if (!t) return {};
  return {
    title: t.title,
    description: t.description,
    keywords: t.keywords,
    alternates: { canonical: `/tools/${t.slug}` },
    openGraph: { title: t.title, description: t.description, url: `/tools/${t.slug}` },
  };
}

export default async function Page({ params }: Props) {
  const t = devTool((await params).slug);
  if (!t) notFound();
  return <DevToolPage tool={t} />;
}
