import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { SpeechBubble } from "@/components/Character";

export const metadata: Metadata = {
  title: "Decrypt an Ethereum keystore v3 file (offline) | SwapChan",
  description:
    "Recover geth, Mist, MyEtherWallet, Parity and MyCrypto UTC--…json keystores locally. Password known: eth-account. Password forgotten: btcrecover with your own hints. Never upload the JSON.",
  alternates: { canonical: "/recover/keystore" },
};

export default function Page() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 text-white">
      <h1 className="text-4xl font-black">Decrypt an Ethereum keystore v3</h1>
      <SpeechBubble who="swapchan">
        That UTC--…json never leaves your disk. Decrypt it offline, print the address, then let me hunt for stuck funds.
      </SpeechBubble>
      <section className="rounded-2xl border-2 border-rose-400 bg-rose-950 p-5">
        Work on a <b>copy</b> of the file. Never paste the JSON or the password into chat or a website.
      </section>
      <ol className="list-decimal space-y-2 pl-6">
        <li>Password known: <code>pip install eth-account</code>, decrypt offline, print address.</li>
        <li>Password forgotten: build passwordlist.txt from YOUR hints, run btcrecover with --typos.</li>
        <li>Public address → find_money → verify_tx → you sign → broadcast_tx.</li>
      </ol>
      <section className="rounded-2xl border-2 border-fuchsia-400 bg-violet-950 p-6">
        <h2 className="text-2xl font-black">Use this in your agent</h2>
        <p>Call <code>recovery_guide</code> with <code>situation=keystore</code> (or <code>password-hints</code>) for the full reference code.</p>
        <AgentCTAs />
      </section>
      <p>
        <Link className="underline" href="/recover">All recovery options</Link> ·{" "}
        <Link className="underline" href="/agents/secure-signing">Signing guide</Link>
      </p>
    </main>
  );
}
