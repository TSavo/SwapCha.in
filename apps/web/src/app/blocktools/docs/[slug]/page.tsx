import { notFound } from "next/navigation";
import { BtPage, btMeta, crumbLd, JsonLd } from "@/components/blocktools/BtPage";
import { BT_REPO, renderMd } from "@/lib/blocktools.server";
import { BT_ITEMS } from "@/lib/blocktoolsManifest";

const items = BT_ITEMS.filter((i) => i.kind === "docs");
export const dynamicParams = false;
export function generateStaticParams() {
  return items.map((i) => ({ slug: i.slug }));
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const it = items.find((i) => i.slug === slug);
  return it ? btMeta(`/blocktools/docs/${it.slug}`, it.title, it.description) : {};
}
export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const it = items.find((i) => i.slug === slug);
  if (!it) notFound();
  const up =
    it.file === "docs/DESIGN.md"
      ? "DESIGN.md"
      : it.file === "docs/wasm.md"
        ? "bindings/wasm/README.md"
        : it.file;
  return (
    <BtPage title={it.title} lead={<p>{it.description}</p>} source={`${BT_REPO}/blob/main/${up}`}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: it.title,
          description: it.description,
          about: { "@type": "SoftwareApplication", name: "blocktools" },
          url: `https://swapchan.com/blocktools/docs/${it.slug}`,
        }}
      />
      <JsonLd
        data={crumbLd([
          ["blocktools", "/blocktools"],
          ["Docs", "/blocktools/docs"],
          [it.title, `/blocktools/docs/${it.slug}`],
        ])}
      />
      <div className="bt-md" dangerouslySetInnerHTML={{ __html: renderMd(it.file) }} />
    </BtPage>
  );
}
