import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { SpeechBubble } from "@/components/Character";

export const metadata: Metadata = {
  title: "Recover a BIP39 seed phrase wallet (offline) | SwapChan",
  description:
    "Scan MetaMask, Ledger Live, Ledger legacy, Trezor, Phantom, Solflare, Trust, Exodus, TronLink and BTC BIP44/49/84/86 paths from a BIP39 phrase. Run locally, offline. Missing-word and passphrase branches included. Never paste the phrase into chat.",
  alternates: { canonical: "/recover/seed-phrase" },
};

export default function Page() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 text-white">
      <h1 className="text-4xl font-black">Recover a BIP39 seed phrase wallet</h1>
      <SpeechBubble who="swapchan">
        Write the scan script to a file on your machine, disconnect the network, type the phrase
        only into that local prompt. I only ever want the PUBLIC addresses it prints.
      </SpeechBubble>
      <section className="rounded-2xl border-2 border-rose-400 bg-rose-950 p-5">
        <b>Never</b> paste the phrase into chat, an AI, email, or any website. &quot;Recovery
        services&quot; that ask for it are scams.
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-2xl font-black">Paths we scan</h2>
        <ul className="list-disc pl-6 text-sm">
          <li>
            EVM MetaMask / Trust / Exodus / Trezor / Rabby:{" "}
            <code>m/44&apos;/60&apos;/0&apos;/0/i</code>
          </li>
          <li>
            Ledger Live EVM: <code>m/44&apos;/60&apos;/i&apos;/0/0</code>
          </li>
          <li>
            Ledger legacy / MEW: <code>m/44&apos;/60&apos;/0&apos;/i</code>
          </li>
          <li>
            Phantom / Solflare: <code>m/44&apos;/501&apos;/i&apos;/0&apos;</code>
          </li>
          <li>
            TronLink: <code>m/44&apos;/195&apos;/0&apos;/0/i</code>
          </li>
          <li>Bitcoin BIP44 / 49 / 84 / 86</li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-2xl font-black">Also covered in the agent playbook</h2>
        <ul className="list-disc pl-6">
          <li>Missing or mistyped word (checksum brute force)</li>
          <li>Forgotten BIP39 passphrase (25th word) via btcrecover + your own hints</li>
        </ul>
        <p>
          Ask your agent: <code>recovery_guide</code> with <code>situation=seed-phrase</code>,{" "}
          <code>missing-word</code> or <code>passphrase</code>. It returns the full reference code
          in-context.
        </p>
      </section>
      <section className="rounded-2xl border-2 border-fuchsia-400 bg-violet-950 p-6">
        <h2 className="text-2xl font-black">Use this in your agent</h2>
        <blockquote className="rounded-xl bg-violet-900 p-4 font-bold">
          “I have a 12-word phrase on paper. Help me scan addresses offline, then find my money.”
        </blockquote>
        <AgentCTAs />
      </section>
      <p>
        Next:{" "}
        <Link className="underline" href="/agents/secure-signing">
          secure signing guide
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/recover">
          all recovery options
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/find-money/guide">
          find stuck money
        </Link>
      </p>
    </main>
  );
}
