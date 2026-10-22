import type { Metadata } from "next";
import Link from "next/link";
import { WidgetConfigurator } from "@/components/WidgetConfigurator";

export const metadata: Metadata = {
  title: "Embed the SwapChan swap widget · earn 50% of the fee",
  description:
    "Drop SwapChan's best-price swap card into your site with one script tag. Every chain incl. Solana, Bitcoin and Tron. Partners earn half of SwapChan's fee.",
  alternates: { canonical: "/widget" },
};

export default function WidgetPage() {
  return (
    <div className="w-full max-w-5xl">
      <h1 className="mt-2 text-3xl font-black">Embed the swap widget</h1>
      <p className="mt-2 max-w-3xl text-violet-200">
        Put SwapChan's swap card on your site: every aggregator and bridge we compare, every chain
        including Solana, Bitcoin and Tron, wallet connect inside the widget. Users never leave your
        page.{" "}
        <Link href="/partners" className="font-bold text-amber-300 underline">
          Register as a partner
        </Link>{" "}
        and you earn <b>50% of SwapChan's 0.1% fee</b> on swaps through your widget. The user pays
        the same either way.
      </p>
      <WidgetConfigurator />
      <h2 className="mt-10 mb-2 text-2xl font-black">Options</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-violet-300">
            <tr>
              <th className="py-1 pr-4">widget.js attribute</th>
              <th className="py-1 pr-4">iframe param</th>
              <th className="py-1">What it does</th>
            </tr>
          </thead>
          <tbody className="text-violet-100">
            {[
              ["data-partner", "partner", "Your partner id (revenue share)"],
              [
                "data-from-chain / data-to-chain",
                "fromChain / toChain",
                "Chain id, e.g. 1, 8453, 792703809 (Solana)",
              ],
              ["data-from-token / data-to-token", "fromToken / toToken", "Token address or mint"],
              ["data-amount", "amount", "Prefilled amount, e.g. 100"],
              ["data-theme", "theme", "dark (default) or light"],
              ["data-accent", "accent", "Button color, e.g. #22c55e"],
              ["data-chan", "chan", "0 hides Swap-chan and the chain characters"],
              ["data-compact", "compact", "1 = shorter card, best route only"],
              ["data-lock-to", "lockTo", '1 = destination can\'t be changed ("buy our token")'],
              ["data-target", "", "CSS selector to mount into (default: where the script is)"],
              ["data-width", "", "iframe width (default 420px)"],
            ].map(([a, b, c]) => (
              <tr key={a} className="border-t border-violet-800">
                <td className="py-1 pr-4 font-mono text-xs">{a}</td>
                <td className="py-1 pr-4 font-mono text-xs">{b}</td>
                <td className="py-1">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-10 mb-2 text-2xl font-black">Events</h2>
      <p className="text-violet-200">
        The widget posts <code>{'{source: "swapchan", type, ...}'}</code> to your page for{" "}
        <code>ready</code>, <code>quote</code>, <code>swap_submitted</code> (with{" "}
        <code>txHash</code>), <code>swap_completed</code> and <code>resize</code>. With widget.js
        you can also listen for a <code>swapchan</code> event on <code>window</code>:
      </p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-black/50 p-3 text-xs">{`window.addEventListener("swapchan", (e) => {
  if (e.detail.type === "swap_completed") console.log("swapped via", e.detail.provider);
});`}</pre>
      <h2 className="mt-10 mb-2 text-2xl font-black">React</h2>
      <p className="text-violet-200">
        An <code>@swapchan/widget</code> React package is coming. Until then, render the iframe
        snippet from above as JSX. It's the same widget.
      </p>
      <h2 className="mt-10 mb-2 text-2xl font-black">Affiliate links</h2>
      <p className="text-violet-200">
        No widget needed: add <code>?ref=your-id</code> (or <code>?partner=</code>) to any
        swapchan.com link, e.g. <code>https://swapchan.com/?ref=your-id</code>, a{" "}
        <code>/swap/…</code> route, a pre-filled deep link or <code>/scanner</code>. The id is kept
        in a first-party cookie for 30 days (last click wins; visits without a ref don&apos;t clear
        it), and quotes and swaps on the main site earn the same share under the same rules. AI
        agents can pass <code>partner</code> to the MCP quote tools; their swap links then carry
        your ref.
      </p>

      <h2 className="mt-10 mb-2 text-2xl font-black">Revenue share</h2>
      <ul className="list-disc space-y-1 pl-5 text-violet-200">
        <li>
          The total fee stays 0.1% (10 bp). You get half of what SwapChan actually earns on each
          swap.
        </li>
        <li>
          Only swaps where the provider confirmed our fee count. Swaps from your own payout address
          don't.
        </li>
        <li>
          Your earnings accrue on your private dashboard and are paid periodically in USDC to your
          payout address.
        </li>
      </ul>
    </div>
  );
}
