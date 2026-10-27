import { BROADCAST_COUNT } from "@swapchan/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { SpeechBubble } from "@/components/Character";

export const metadata: Metadata = {
  title: "How to let an AI agent sign crypto transactions safely | SwapChan",
  description:
    "Signing starts with 'do you have the key?': local offline key recovery, then verify_tx, human sign-off on EVERY transaction, then broadcast_tx. Full playbook via the signing_guide MCP tool. SwapChan never holds keys.",
  alternates: { canonical: "/agents/secure-signing" },
};

const STEPS = [
  {
    n: "1",
    title: "Key recovery — do you have the key?",
    body: "If the user cannot already sign, recover the key LOCALLY and OFFLINE. BIP39, missing words, passphrase, keystore v3, 2014-15 presale, Electrum, wallet.dat, hardware, raw keys. Only PUBLIC addresses leave the machine.",
    href: "/recover",
  },
  {
    n: "2",
    title: "Verify",
    body: "Run verify_tx on every unsigned tx. Calldata guard + simulation returns a verdict (ok / caution / danger), findings and a plain-language summary.",
    href: "#verify",
  },
  {
    n: "3",
    title: "Human sign-off and sign locally",
    body: "Default and baseline: a human reviews and signs EVERY transaction in their own wallet (hardware preferred). Autonomous / session-key signing is advanced-only with hard caveats.",
    href: "#sign",
  },
  {
    n: "4",
    title: "Broadcast",
    body: `Optional relay of already-signed bytes via broadcast_tx (${BROADCAST_COUNT} chains; see /broadcast for the list, any other chain is sent from your own wallet). Private via Flashbots Protect on Ethereum. Cannot alter a signed tx. Track with tx_status.`,
    href: "/broadcast",
  },
];

export default function Page() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10 text-white">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-black">How to let an AI agent sign crypto safely</h1>
        <SpeechBubble who="swapchan">
          I find the money and build the unsigned tx. You keep the keys. Every single transaction
          gets your explicit yes before your wallet signs it. That&apos;s the deal, senpai.
        </SpeechBubble>
      </header>

      <section className="rounded-2xl border-2 border-emerald-400 bg-emerald-950 p-6">
        <h2 className="text-2xl font-black">Trustless</h2>
        <p>
          SwapChan <b>never signs, never holds keys or funds, and cannot move money</b>. It only
          builds unsigned transactions and (optionally) relays bytes your wallet already signed.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-black">The loop</h2>
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-2xl border border-fuchsia-400/40 bg-violet-950 p-5">
            <div className="text-amber-300 font-black">Step {s.n}</div>
            <h3 className="text-xl font-black">
              <Link href={s.href} className="hover:underline">
                {s.title}
              </Link>
            </h3>
            <p className="text-violet-100">{s.body}</p>
          </div>
        ))}
      </section>

      <section id="verify" className="flex flex-col gap-3">
        <h2 className="text-2xl font-black">
          Verification guide (always ships with signing_guide)
        </h2>
        <ol className="list-decimal space-y-2 pl-6 text-sm">
          <li>Decode calldata against the verified ABI. Unknown selector → stop.</li>
          <li>
            Right contract: allowlist / docs, verified source, not brand-new, not a lookalike.
          </li>
          <li>Right recipient: every to/receiver is the user (or the person they named).</li>
          <li>Right price: minOut vs an independent quote (SwapChan get_quote).</li>
          <li>Simulate: eth_simulateV1 / eth_call / Solana simulateTransaction; diff balances.</li>
          <li>
            Red flags: unlimited approve, permit/Permit2, setApprovalForAll, Safe DELEGATECALL,
            upgradeTo, ownership transfers, EIP-7702, unexpected value; Solana unknown programs;
            Tron AccountPermissionUpdate.
          </li>
          <li>Explain in plain language.</li>
          <li>Human sign-off for THIS tx, every time.</li>
        </ol>
      </section>

      <section id="sign" className="flex flex-col gap-3">
        <h2 className="text-2xl font-black">Custody options</h2>
        <ul className="list-disc pl-6">
          <li>
            <b>Recommended:</b> the user&apos;s own wallet (MetaMask, Rabby, Phantom, TronLink) or a
            hardware wallet.
          </li>
          <li>
            Embedded / MPC (Turnkey, Privy, Lit, Coinbase CDP / AgentKit): configure per-tx human
            approval.
          </li>
          <li>
            Local keystore: developers only, unlocked by the human per tx. Never put a raw key in a
            prompt.
          </li>
        </ul>
        <p className="text-sm text-violet-200">
          Advanced autonomous / session-key signing is <b>not</b> the default. If you must: scope to
          specific contracts and selectors, small caps, short expiry, exact-amount approvals, and
          still run verify_tx before every send.
        </p>
      </section>

      <section className="rounded-2xl border-2 border-fuchsia-400 bg-violet-950 p-6">
        <h2 className="text-2xl font-black">Use this in your agent</h2>
        <p>
          Call MCP <code>signing_guide</code> (returns the full playbook including key recovery) or{" "}
          <code>recovery_guide</code>. Pass <code>situation</code> for one branch. Then{" "}
          <code>verify_tx</code> → human signs → <code>broadcast_tx</code>.
        </p>
        <blockquote className="rounded-xl bg-violet-900 p-4 font-bold">
          “Here’s my wallet, find me money. Then walk me through signing safely.”
        </blockquote>
        <AgentCTAs />
      </section>

      <p className="text-sm">
        <Link className="underline" href="/recover">
          Key recovery hub
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/broadcast">
          Broadcast tool
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/find-money/guide">
          Find money guide
        </Link>
      </p>
    </main>
  );
}
