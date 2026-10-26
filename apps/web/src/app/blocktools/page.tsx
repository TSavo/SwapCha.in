import Link from "next/link";
import { BtPage, btMeta, JsonLd } from "@/components/blocktools/BtPage";
import { CopyCode } from "@/components/blocktools/CopyCode";
import { BT_EXAMPLES, BT_GROUPS, BT_INSTALL } from "@/lib/blocktools";
import { BT_REPO, getReleases, mb } from "@/lib/blocktools.server";
import { BT_ITEMS, BT_TOOLS } from "@/lib/blocktoolsManifest";
import { DEV_TOOLS } from "@/lib/devTools";

export const revalidate = 3600;
export const metadata = btMeta(
  "/blocktools",
  "blocktools: all chains, one CLI",
  "blocktools is a command-line toolkit for blockchains: 43 small Unix tools that read wallets, derive addresses and build, check and sign transactions offline, across 66 verified chain rows. Free, MIT.",
);

const pill =
  "rounded-full border border-violet-500 px-3 py-1 text-sm font-bold text-violet-100 hover:border-amber-300 hover:text-amber-300";

export default async function BlocktoolsHome() {
  const { releases } = await getReleases();
  const latest = releases[0];
  const docs = BT_ITEMS.filter((i) => i.kind === "docs");
  const recipes = BT_ITEMS.filter((i) => i.kind === "recipes");
  const desc = Object.fromEntries(BT_TOOLS.map((t) => [t.name, t.desc]));
  return (
    <BtPage
      title="All chains, one CLI"
      lead={
        <>
          <p className="text-lg">
            <b className="text-amber-300">blocktools</b> is a set of small Unix filters (Rust; one
            JSON object per line on stdin/stdout) that you chain into pipelines. It recovers keys
            and addresses from old wallet files and seed phrases, and builds, checks and signs
            transactions, offline. No browser, no wallet app.
          </p>
          <p className="mt-2 text-sm text-violet-300">
            43 commands with man pages · 66 verified rows in its chain table (Bitcoin, Ethereum and
            EVM, Solana, Tron, XRP, Cosmos, Cardano, Polkadot, TON, Litecoin, Dogecoin, Qtum,
            Feathercoin and more) · MIT license ·{" "}
            {latest ? `latest release ${latest.tag}` : "releases on GitHub"}
          </p>
        </>
      }
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "blocktools",
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Linux x86_64 (release binaries); build from source elsewhere",
          softwareVersion: latest?.tag,
          license: "https://opensource.org/licenses/MIT",
          url: "https://swapchan.com/blocktools",
          downloadUrl: latest?.url,
          sameAs: BT_REPO,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          description:
            "Command-line toolkit that recovers keys and addresses from old wallet files and seed phrases, and builds, checks and signs transactions offline.",
        }}
      />

      <section className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <h2 className="mb-2 text-xl font-black">
            Install (Linux x86_64, {latest?.tag ?? "v0.1.0"})
          </h2>
          <CopyCode code={BT_INSTALL} />
          <p className="mt-2 text-sm text-violet-300">
            Do not skip the checksum: an archive that fails <code>sha256sum -c</code> must not be
            run. No macOS, Windows or ARM asset:{" "}
            <Link className="underline" href="/blocktools/install">
              build from source
            </Link>
            .
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/blocktools/docs/getting-started"
              className="rounded-full bg-amber-400 px-4 py-2 font-black text-violet-950 shadow-[0_0_18px_rgba(251,191,36,0.45)]"
            >
              Get started
            </Link>
            <Link href="/blocktools/commands" className={pill}>
              All 43 commands
            </Link>
            <Link href="/blocktools/binaries" className={pill}>
              Binaries
            </Link>
            <a href={BT_REPO} className={pill} rel="noopener">
              GitHub
            </a>
          </div>
        </div>
        <div className="hidden flex-col items-center md:flex">
          <img
            src="/characters/full/swapchan.webp"
            alt="Swap-chan"
            width={832}
            height={1088}
            className="animate-float w-32 drop-shadow-[0_0_24px_rgba(217,70,239,0.55)]"
          />
          <p className="max-w-[12rem] rounded-xl border border-fuchsia-400/70 bg-violet-950/80 p-2 text-center text-xs text-violet-100">
            Every tool on SwapChan runs on this, senpai~ Your keys stay on your machine.
          </p>
        </div>
      </section>

      <div className="mt-6 rounded-xl border border-rose-400/70 bg-rose-950/50 p-4 text-sm text-rose-50">
        <b>Dangerous with real funds.</b> Code that handles keys and signs transactions should be
        read and audited by you before you trust it. Run anything that touches a secret sealed and
        offline (<code>./blocktools run</code>, <code>--network none</code>). See{" "}
        <Link className="underline" href="/blocktools/docs/security">
          Security
        </Link>
        .
      </div>

      <h2 className="mt-10 mb-3 text-2xl font-black">How it works</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {[
          [
            "Pipes",
            "Each tool reads and writes one JSON object per line. Chain them: seed-repair | seed-to-master | derive.",
          ],
          [
            "Sealed runs",
            "./blocktools run '<pipeline>' runs in a container with --network none, a read-only root, all capabilities dropped and redacted output.",
          ],
          [
            "Humans sign",
            "tx-sign needs a real terminal and a typed code. A policy file can limit destinations, amounts and fees, checked before and after signing.",
          ],
        ].map(([h, t]) => (
          <div key={h} className="rounded-xl border border-violet-500/70 bg-violet-900/40 p-4">
            <h3 className="font-black text-amber-300">{h}</h3>
            <p className="mt-1 text-sm text-violet-100">{t}</p>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <CopyCode
          label="Example: a seed phrase to its first Bitcoin address (public test vector)"
          code="./blocktools run 'seed-repair < /in/seed.txt | seed-to-master | derive --chain btc --count 1'"
        />
      </div>

      <h2 className="mt-10 mb-3 text-2xl font-black" id="commands">
        Commands
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {BT_GROUPS.map((g) => (
          <div key={g.id} className="rounded-xl border border-violet-500/70 bg-violet-900/30 p-4">
            <h3 className="font-black">{g.label}</h3>
            <p className="mb-2 text-xs text-violet-300">{g.blurb}</p>
            <ul className="flex flex-wrap gap-1.5">
              {g.tools.map((t) => (
                <li key={t}>
                  <Link
                    href={`/blocktools/commands#${t}`}
                    title={desc[t]}
                    className="rounded-md bg-black/40 px-1.5 py-0.5 font-mono text-xs text-amber-200 hover:text-amber-300"
                  >
                    {t}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h2 className="mt-10 mb-3 text-2xl font-black">Recipes</h2>
      <p className="mb-3 text-sm text-violet-300">
        Task-based how-tos from the repo&apos;s recipes folder. Every tested example in them runs in
        CI.
      </p>
      <ul className="flex flex-wrap gap-2">
        {recipes.map((r) => (
          <li key={r.slug}>
            <Link href={`/blocktools/recipes/${r.slug}`} className={pill}>
              {r.title}
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 mb-3 text-2xl font-black">Examples</h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {BT_EXAMPLES.map((e) => (
          <li key={e.slug} className="min-w-0">
            <Link
              href={`/blocktools/examples/${e.slug}`}
              className="block rounded-xl border border-violet-500/70 bg-violet-900/30 p-3 hover:border-amber-300"
            >
              <b>{e.title}</b>
              <code className="mt-1 block truncate text-xs text-amber-200">{e.cmds[0]}</code>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 mb-3 text-2xl font-black">Docs</h2>
      <form action="/blocktools/docs" className="mb-3">
        <input
          name="q"
          type="search"
          placeholder="Search the docs, recipes and examples…"
          aria-label="Search blocktools docs"
          className="w-full rounded-full border-2 border-violet-500 bg-violet-950/70 px-5 py-2.5 text-violet-50 placeholder:text-violet-400 focus:border-amber-300 focus:outline-none"
        />
      </form>
      <ul className="flex flex-wrap gap-2">
        {docs.map((d) => (
          <li key={d.slug}>
            <Link href={`/blocktools/docs/${d.slug}`} className={pill}>
              {d.title}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/blocktools/faq" className={pill}>
            Troubleshooting / FAQ
          </Link>
        </li>
        <li>
          <Link href="/blocktools/mcp" className={pill}>
            MCP and SwapChan
          </Link>
        </li>
      </ul>

      <h2 className="mt-10 mb-3 text-2xl font-black">Binaries and releases</h2>
      {latest && (
        <div className="rounded-xl border border-violet-500/70 bg-violet-900/30 p-4 text-sm">
          <p>
            <b>{latest.tag}</b> · {latest.date.slice(0, 10)} · {latest.body}
          </p>
          <ul className="mt-2 space-y-1">
            {latest.assets.map((a) => (
              <li key={a.name}>
                <a href={a.url} className="font-mono text-amber-300 underline">
                  {a.name}
                </a>{" "}
                <span className="text-violet-400">({mb(a.size)})</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            <Link href="/blocktools/binaries" className="underline">
              Platform table
            </Link>{" "}
            ·{" "}
            <Link href="/blocktools/releases" className="underline">
              All releases
            </Link>{" "}
            ·{" "}
            <Link href="/blocktools/install" className="underline">
              Install guide
            </Link>
          </p>
        </div>
      )}

      <h2 className="mt-10 mb-3 text-2xl font-black">See it on the web: SwapChan</h2>
      <p className="mb-3 text-sm text-violet-200">
        SwapChan is a friendly website built on blocktools. These pages run blocktools functions
        (its wasm build) on public input: no keys, no seeds, nothing stored. Your AI agent can call
        the same tools over{" "}
        <Link className="underline" href="/blocktools/mcp">
          MCP
        </Link>
        .
      </p>
      <ul className="flex flex-wrap gap-2">
        {DEV_TOOLS.map((t) => (
          <li key={t.slug}>
            <Link href={`/tools/${t.slug}`} className={pill}>
              {t.emoji} {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </BtPage>
  );
}
