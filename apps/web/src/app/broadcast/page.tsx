import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { SpeechBubble } from "@/components/Character";

export const metadata: Metadata = {
  title: "Broadcast a signed crypto transaction | SwapChan",
  description:
    "Relay an already-signed EVM, Solana, Tron or Bitcoin transaction. Decodes, runs guard checks, optional Flashbots Protect on Ethereum. SwapChan cannot alter signed bytes. Pair with verify_tx and signing_guide.",
  alternates: { canonical: "/broadcast" },
};

export default function Page() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 text-white">
      <h1 className="text-4xl font-black">Broadcast a signed transaction</h1>
      <SpeechBubble who="swapchan">
        You signed it. I just put it on the wire. I can&apos;t change a single byte of a signed tx,
        and I never held the key.
      </SpeechBubble>
      <section className="rounded-2xl border-2 border-emerald-400 bg-emerald-950 p-5">
        <b>Trustless:</b> broadcast_tx only relays bytes your wallet already signed. Optional{" "}
        <code>strict</code> refuses danger verdicts. Optional <code>private</code> uses Flashbots
        Protect on Ethereum mainnet.
      </section>
      <ul className="list-disc space-y-2 pl-6">
        <li>EVM: raw signed hex (0x…)</li>
        <li>Solana: base64 transaction</li>
        <li>Tron: signed tx JSON</li>
        <li>Bitcoin: raw hex via mempool.space</li>
      </ul>
      <p className="text-sm text-violet-200">
        Other coins (LTC, DOGE, BCH, DASH, ZEC and the other old coins find_money can sweep) are not
        relayed here: sign the unsigned sweep in the coin&apos;s own wallet and send it from there.
      </p>
      <p>
        API: <code>POST https://api.swapchan.com/onchain/broadcast</code> · status:{" "}
        <code>GET /onchain/tx-status?chainId=&amp;hash=</code>
      </p>
      <section className="rounded-2xl border-2 border-fuchsia-400 bg-violet-950 p-6">
        <h2 className="text-2xl font-black">Use this in your agent</h2>
        <p>
          Full loop: <code>find_money</code> → <code>verify_tx</code> → human signs →{" "}
          <code>broadcast_tx</code> → <code>tx_status</code>. See the{" "}
          <Link className="underline" href="/agents/secure-signing">
            secure signing guide
          </Link>
          .
        </p>
        <AgentCTAs />
      </section>
    </main>
  );
}
