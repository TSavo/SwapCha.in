import Link from "next/link";
import { notFound } from "next/navigation";
import { BtPage, btMeta, crumbLd, JsonLd } from "@/components/blocktools/BtPage";
import { CopyCode } from "@/components/blocktools/CopyCode";
import { BT_EXAMPLES } from "@/lib/blocktools";
import { BT_REPO } from "@/lib/blocktools.server";

export const dynamicParams = false;
export function generateStaticParams() {
  return BT_EXAMPLES.map((e) => ({ slug: e.slug }));
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = BT_EXAMPLES.find((x) => x.slug === slug);
  return e ? btMeta(`/blocktools/examples/${e.slug}`, e.title, e.description) : {};
}
export default async function ExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = BT_EXAMPLES.find((x) => x.slug === slug);
  if (!e) notFound();
  return (
    <BtPage
      title={e.title}
      lead={<p>{e.description}</p>}
      source={`${BT_REPO}#worked-examples-public-test-fixtures-only`}
    >
      <JsonLd
        data={crumbLd([
          ["blocktools", "/blocktools"],
          ["Examples", "/blocktools/examples"],
          [e.title, `/blocktools/examples/${e.slug}`],
        ])}
      />
      <h2 className="mb-2 text-xl font-black">Input</h2>
      <p className="mb-4 text-violet-100">
        {e.input} Put the file in <code>./in/</code> and its password in <code>./secrets/</code>.
        Never put a real wallet on a networked machine.
      </p>
      <h2 className="mb-2 text-xl font-black">Run</h2>
      <div className="space-y-3">
        {e.cmds.map((c) => (
          <CopyCode key={c} code={c} />
        ))}
      </div>
      <h2 className="mt-6 mb-2 text-xl font-black">CI expects in the output</h2>
      <ul className="list-disc pl-6 font-mono text-sm text-amber-200">
        {e.expect.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-violet-200">
        Key fields print as <code>[REDACTED]</code>. Full recipe:{" "}
        <Link href={`/blocktools/recipes/${e.recipe}`} className="underline">
          {e.recipe}
        </Link>{" "}
        ·{" "}
        <Link href="/blocktools/examples" className="underline">
          all examples
        </Link>
      </p>
    </BtPage>
  );
}
