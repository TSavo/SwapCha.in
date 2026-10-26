import { notFound } from "next/navigation";
import { BtPage, btMeta, crumbLd, JsonLd } from "@/components/blocktools/BtPage";
import { BT_REPO, renderMd } from "@/lib/blocktools.server";
import { BT_ITEMS } from "@/lib/blocktoolsManifest";

const items = BT_ITEMS.filter((i) => i.kind === "recipes");
export const dynamicParams = false;
export function generateStaticParams() {
  return items.map((i) => ({ slug: i.slug }));
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const it = items.find((i) => i.slug === slug);
  return it ? btMeta(`/blocktools/recipes/${it.slug}`, it.title, it.description) : {};
}
export default async function RecipePage({ params }: { params: Promise<{ slug: string }> }) {
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
    <BtPage
      title={it.title}
      lead={<p>{it.description}</p>}
      source={it.group === "swapchan" ? undefined : `${BT_REPO}/blob/main/${up}`}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          headline: it.title,
          description: it.description,
          about: { "@type": "SoftwareApplication", name: "blocktools" },
          url: `https://swapchan.com/blocktools/recipes/${it.slug}`,
        }}
      />
      <JsonLd
        data={crumbLd([
          ["blocktools", "/blocktools"],
          ["Recipes", "/blocktools/recipes"],
          [it.title, `/blocktools/recipes/${it.slug}`],
        ])}
      />
      <div className="bt-md" dangerouslySetInnerHTML={{ __html: renderMd(it.file) }} />
    </BtPage>
  );
}
