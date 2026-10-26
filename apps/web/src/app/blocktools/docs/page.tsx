import Link from "next/link";
import { BtPage, btMeta } from "@/components/blocktools/BtPage";
import { DocsSearch } from "@/components/blocktools/DocsSearch";
import { BT_EXAMPLES } from "@/lib/blocktools";
import { searchIndex } from "@/lib/blocktools.server";
import { BT_ITEMS } from "@/lib/blocktoolsManifest";

export const metadata = btMeta(
  "/blocktools/docs",
  "blocktools documentation",
  "Searchable blocktools docs: getting started, security model, supported chains, refusal and exit codes, policy files, RPC, the Rust library and wasm bindings.",
);

export default function DocsIndex() {
  const docs = BT_ITEMS.filter((i) => i.kind === "docs");
  const index = [
    ...searchIndex(),
    ...BT_EXAMPLES.map((e) => ({
      href: `/blocktools/examples/${e.slug}`,
      title: e.title,
      kind: "Example",
      text: `${e.description} ${e.cmds.join(" ")}`,
    })),
  ];
  return (
    <BtPage
      title="Documentation"
      lead={<p>The blocktools docs, rendered from the repo. Search everything, or pick a page.</p>}
    >
      <DocsSearch docs={index} />
      <ul className="grid gap-3 md:grid-cols-2">
        {[
          ...docs.map((d) => ({
            href: `/blocktools/docs/${d.slug}`,
            title: d.title,
            description: d.description,
          })),
          {
            href: "/blocktools/faq",
            title: "Troubleshooting / FAQ",
            description: "Common errors and what to do.",
          },
        ].map((d) => (
          <li key={d.href}>
            <Link
              href={d.href}
              className="block h-full rounded-xl border border-violet-500/70 bg-violet-900/30 p-4 hover:border-amber-300"
            >
              <b className="text-amber-300">{d.title}</b>
              <p className="mt-1 text-sm text-violet-200">{d.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </BtPage>
  );
}
