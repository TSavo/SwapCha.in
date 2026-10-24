import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTASection } from "@/components/AgentCTASection";
import { EarnCalculator } from "@/components/EarnCalculator";
import { castHref } from "@/lib/bios";

const TITLE = "Make money with SwapChan: earn 5 bp on every swap you refer";
const DESC =
  "Embed the SwapChan swap widget, share a ?ref= affiliate link, or route AI-agent swaps with a partner id, and earn half of SwapChan's 0.1% fee.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/earn" },
  openGraph: {
    title: TITLE,
    description: DESC,
    url: "/earn",
    images: ["/characters/og/swapchan.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESC,
    images: ["/characters/og/swapchan.png"],
  },
};

const btn =
  "inline-block rounded-xl bg-amber-400 px-5 py-3 font-black text-violet-950 hover:bg-amber-300";

const WAYS = [
  {
    chan: "base",
    title: "Embed the widget",
    body: "Drop the swap card on your site with one script tag. Swaps made in it earn you 5 bp.",
    href: "/widget",
    cta: "Get the widget",
  },
  {
    chan: "solana",
    title: "Share an affiliate link",
    body: "Add ?ref=<partner-id> to any swapchan.com link. 30-day last-click attribution: the most recent ref wins.",
    href: "/partners",
    cta: "Get your partner id",
  },
  {
    chan: "bitcoin",
    title: "Route AI agents",
    body: "Pass your partner id as the partner param to the MCP quote tools. Swap links your agent returns carry your ref.",
    href: "/agents",
    cta: "For AI agents",
  },
] as const;

const FAQ = [
  [
    "How do payouts work?",
    "Earnings accrue on your private partner dashboard and are paid periodically in USDC to the payout address you registered.",
  ],
  [
    "How long does attribution last?",
    "Affiliate links set a first-party cookie for 30 days. Last click wins, and visits without a ref don't clear it. Widget swaps are always yours.",
  ],
  [
    "Which swaps count?",
    "Swaps where the provider confirmed SwapChan's fee. Swaps from your own payout address don't count. The user pays the same 0.1% either way.",
  ],
  [
    "How much do I earn?",
    "Half of SwapChan's 0.1% (10 bp) fee: 5 bp, or $5 per $10,000 of swap volume you refer.",
  ],
] as const;

export default function EarnPage() {
  return (
    <div className="w-full max-w-4xl">
      <section className="my-6 flex flex-col items-center gap-6 md:flex-row">
        <Link href={castHref("swapchan")} className="shrink-0" title="Meet Swap-chan">
          <img src="/characters/swapchan.png" alt="Swap-chan" width={170} height={170} />
        </Link>
        <div className="text-center md:text-left">
          <h1 className="text-4xl font-black">Make money with SwapChan</h1>
          <p className="mt-3 text-violet-200">
            Send swaps our way and earn <b>half of SwapChan&apos;s 0.1% fee</b> on each one. Your
            users pay exactly what they&apos;d pay on swapchan.com.
          </p>
          <div className="mt-4">
            <Link href="/partners" className={btn}>
              Become a partner
            </Link>
          </div>
        </div>
      </section>

      <EarnCalculator />

      <h2 className="mt-10 mb-4 text-2xl font-black">Three ways to earn</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {WAYS.map((w) => (
          <div
            key={w.title}
            className="flex flex-col rounded-2xl border border-violet-700 bg-violet-950/60 p-5"
          >
            <Link href={castHref(w.chan)} title={`Meet ${w.chan}-chan`}>
              <img
                src={`/characters/${w.chan}.png`}
                alt={`${w.chan} chan`}
                width={72}
                height={72}
              />
            </Link>
            <h3 className="mt-2 text-lg font-black">{w.title}</h3>
            <p className="mt-1 flex-1 text-sm text-violet-200">{w.body}</p>
            <Link href={w.href} className={`${btn} mt-4 text-center text-sm`}>
              {w.cta}
            </Link>
          </div>
        ))}
      </div>

      <section className="mt-10 rounded-2xl border border-amber-400/60 p-6 text-center">
        <h2 className="text-2xl font-black">Get your partner id</h2>
        <p className="mt-2 text-violet-200">
          Sign up takes a minute: pick an id and get a private dashboard with your earnings.
        </p>
        <Link href="/partners" className={`${btn} mt-4`}>
          Sign up at /partners
        </Link>
      </section>

      <h2 className="mt-10 mb-3 text-2xl font-black">FAQ</h2>
      <div className="space-y-3">
        {FAQ.map(([q, a]) => (
          <details key={q} className="rounded-xl border border-violet-700 p-4" open>
            <summary className="cursor-pointer font-bold">{q}</summary>
            <p className="mt-2 text-sm text-violet-200">{a}</p>
          </details>
        ))}
      </div>
      <AgentCTASection />
    </div>
  );
}
