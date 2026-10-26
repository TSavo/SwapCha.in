import Link from "next/link";
import { BtPage, btMeta } from "@/components/blocktools/BtPage";
import { BT_ITEMS } from "@/lib/blocktoolsManifest";

export const metadata = btMeta(
  "/blocktools/recipes",
  "blocktools recipes: task-based how-tos",
  "Short blocktools how-tos by task, input and chain: check a balance, sweep, verify before signing, decode a transaction, read a keystore, wallet.dat or seed phrase.",
);

const GROUPS: [string, string][] = [
  ["swapchan", "Tasks"],
  ["goal", "Goals"],
  ["input", "By what you have"],
  ["chain", "By chain"],
];

export default function RecipesIndex() {
  const rs = BT_ITEMS.filter((i) => i.kind === "recipes");
  return (
    <BtPage
      title="Recipes"
      lead={
        <p>
          Task-based how-tos. Recipes under Goals, By what you have and By chain are the repo&apos;s
          own; every tested example in them is run by CI. Tasks combine those commands with
          SwapChan.
        </p>
      }
    >
      {GROUPS.map(([g, label]) => (
        <section key={g} className="mb-8">
          <h2 className="mb-3 text-xl font-black">{label}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {rs
              .filter((r) => r.group === g)
              .map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/blocktools/recipes/${r.slug}`}
                    className="block h-full rounded-xl border border-violet-500/70 bg-violet-900/30 p-4 hover:border-amber-300"
                  >
                    <b className="text-amber-300">{r.title}</b>
                    <p className="mt-1 text-sm text-violet-200">{r.description}</p>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </BtPage>
  );
}
