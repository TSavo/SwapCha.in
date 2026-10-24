import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { SpeechBubble } from "@/components/Character";

export const metadata: Metadata = {
  title: "Recover an Ethereum 2014–15 crowdsale / presale wallet | SwapChan",
  description:
    "Decrypt the original ethereum.org crowdsale JSON (encseed + ethaddr) offline with pyethsaletool or btcrecover. Many untouched presale keys still hold ETH, airdrops and stuck DeFi. Never upload the file.",
  alternates: { canonical: "/recover/ethereum-presale-wallet-2015" },
};

export default function Page() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 text-white">
      <h1 className="text-4xl font-black">Ethereum 2014–15 crowdsale wallet</h1>
      <SpeechBubble who="swapchan">
        Bought ETH in the crowdsale and still have that JSON? A lot of those keys have been sitting quiet for a decade.
        Decrypt offline, then I&apos;ll look for every coin still stuck to that address.
      </SpeechBubble>
      <section className="rounded-2xl border-2 border-rose-400 bg-rose-950 p-5">
        The file has <code>encseed</code>, <code>ethaddr</code>, sometimes <code>email</code> / <code>bkp</code>. Never
        email it to a &quot;recovery service&quot;. Work on a copy, offline.
      </section>
      <ol className="list-decimal space-y-2 pl-6">
        <li>Decrypt with <code>pyethsaletool.py getprivkey wallet.json</code> or <code>btcrecover --wallet-type ethereum_presale</code>.</li>
        <li>Forgotten password: btcrecover + a passwordlist built from your own hints.</li>
        <li>Public address → find_money (ETH, airdrops, old DeFi) → verify_tx → you sign → broadcast_tx.</li>
      </ol>
      <section className="rounded-2xl border-2 border-fuchsia-400 bg-violet-950 p-6">
        <h2 className="text-2xl font-black">Use this in your agent</h2>
        <p>Call <code>recovery_guide</code> with <code>situation=presale</code> for the complete offline playbook.</p>
        <AgentCTAs />
      </section>
      <p>
        <Link className="underline" href="/recover">All recovery options</Link> ·{" "}
        <Link className="underline" href="/find-money/guide">Where money gets stuck</Link>
      </p>
    </main>
  );
}
