import type { Metadata } from "next";
import { AgentCTAs, ClientTabs } from "@/components/AgentCTA";
import { API_URL, CONFIGS, MCP_URL, TOOLS } from "@/lib/agents";

const REGISTER = `curl -X POST ${API_URL}/partners -H 'content-type: application/json' \\
  -d '{"name":"My Agent","siteUrl":"https://github.com/me/my-agent","evmAddress":"0xYourPayoutAddress"}'`;

export const metadata: Metadata = {
  title: "SwapChan for AI agents: MCP server + API",
  description:
    "Give your AI agent best-price same-chain and cross-chain swap quotes via SwapChan's MCP server and REST API. Agent builders earn 5 bp on every swap they route.",
};

export default function Agents() {
  return (
    <div className="w-full max-w-4xl">
      <section className="my-6 flex flex-col items-center gap-6 rounded-3xl border border-fuchsia-400/40 bg-gradient-to-br from-violet-900 to-fuchsia-900/70 p-8 text-center md:flex-row md:text-left">
        <div className="relative shrink-0">
          <img src="/characters/swapchan.png" alt="Swap-chan" width={180} height={180} />
          <span className="absolute -right-2 -bottom-2 text-5xl">💻</span>
        </div>
        <div className="flex flex-col items-center gap-4 md:items-start">
          <h1 className="text-3xl font-black md:text-4xl">Your AI agent can swap too~</h1>
          <p className="text-violet-200">
            Swap-chan asks every aggregator and bridge (0x, CoW, Velora, LI.FI, Across, Relay) and
            hands your agent the best route on any chain. Paste the instructions into your agent and
            it sets itself up. Builders earn 5 bp on every swap their agent routes.
          </p>
          <AgentCTAs />
        </div>
      </section>

      <h2 id="setup" className="mt-10 mb-3 scroll-mt-4 text-2xl font-black">
        Set this up for my agent
      </h2>
      <ClientTabs />

      <h2 className="mt-10 mb-3 text-2xl font-black">Tools</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {TOOLS.map(([name, desc]) => (
          <div key={name} className="rounded-xl bg-violet-950/70 p-3">
            <code className="font-bold text-amber-300">{name}</code>
            <p className="text-sm text-violet-200">{desc}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-violet-300">
        Transport: Streamable HTTP at <code>{MCP_URL}</code>, or stdio (
        <code>swapchan-mcp --stdio</code>). SwapChan never holds keys: <code>build_swap_tx</code>{" "}
        returns an unsigned tx for the user's own wallet.
      </p>

      <h2 id="earn" className="mt-10 mb-3 scroll-mt-4 text-2xl font-black">
        Earn 5 bp on every swap your agent routes
      </h2>
      <p className="mb-3 text-violet-200">
        Building an agent, bot or app on SwapChan? Register a partner id with your payout address
        and pass <code>partner</code> in <code>get_quote</code> / <code>compare_routes</code> (REST:{" "}
        <code>&amp;partner=&lt;id&gt;</code>). You get half our 0.1% fee, 5 bp, on every swap with a
        verified fee, tracked on a private dashboard. The swapUrl carries <code>?ref=</code>, so
        swaps finished on swapchan.com count too (30-day cookie). Agents can register themselves for
        their operator; the copied instructions explain how.
      </p>
      <pre className="overflow-x-auto rounded-lg bg-black/50 p-3 text-xs">{REGISTER}</pre>
      <p className="mt-2 text-sm text-violet-300">
        Returns your <code>id</code>, a private <code>token</code> and your dashboard link. Or sign
        up on the{" "}
        <a href="/partners" className="text-amber-300 underline">
          partners page
        </a>
        . Self-referrals don't count.
      </p>

      <p className="mt-4 text-sm text-violet-300">
        Building a site instead of an agent? Drop in the{" "}
        <a href="/widget" className="text-amber-300 underline">
          embeddable swap widget
        </a>{" "}
        and earn half our fee.
      </p>

      <h2 id="rest-api" className="mt-10 mb-3 text-2xl font-black">
        REST API
      </h2>
      <p className="mb-3 text-violet-200">
        Same engine over HTTP at <code>{API_URL}</code>: <code>/chains</code>, <code>/tokens</code>,{" "}
        <code>/quotes</code>, <code>/quote</code> (best only), <code>/build</code>,{" "}
        <code>/status</code>. Amounts are in base units.
      </p>
      <pre className="overflow-x-auto rounded-lg bg-black/50 p-3 text-xs">{CONFIGS.curl}</pre>
      <p className="mt-3 text-sm text-violet-300">
        Auth: open with fair rate limits today. For higher limits, ask for a key and send it as{" "}
        <code>x-api-key: &lt;key&gt;</code> (or <code>Authorization: Bearer &lt;key&gt;</code>) to
        both the API and the MCP server.
      </p>
    </div>
  );
}
