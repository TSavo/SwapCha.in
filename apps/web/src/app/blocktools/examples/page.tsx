import Link from "next/link";
import { BtPage, btMeta } from "@/components/blocktools/BtPage";
import { BT_EXAMPLES } from "@/lib/blocktools";

export const metadata = btMeta(
  "/blocktools/examples",
  "blocktools examples",
  "Worked blocktools examples on public test fixtures: seed phrase, wallet.dat, Ethereum keystore, Electrum, MultiBit and Armory to addresses, and identifying an unknown file.",
);

export default function ExamplesIndex() {
  return (
    <BtPage
      title="Examples"
      lead={
        <p>
          Worked examples from the README, on public test fixtures only. CI runs each command as
          written, through the same sealed boundary.
        </p>
      }
    >
      <ul className="grid gap-3 md:grid-cols-2">
        {BT_EXAMPLES.map((e) => (
          <li key={e.slug}>
            <Link
              href={`/blocktools/examples/${e.slug}`}
              className="block h-full rounded-xl border border-violet-500/70 bg-violet-900/30 p-4 hover:border-amber-300"
            >
              <b className="text-amber-300">{e.title}</b>
              <p className="mt-1 text-sm text-violet-200">{e.description}</p>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-violet-300">
        More, by task and chain:{" "}
        <Link href="/blocktools/recipes" className="underline">
          recipes
        </Link>
        .
      </p>
    </BtPage>
  );
}
