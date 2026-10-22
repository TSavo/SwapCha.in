import type { Metadata } from "next";
import { CopyButton, InstallLink } from "@/components/CopyButton";
import { API_URL, CONFIGS, CURSOR_INSTALL, MCP_URL, TOOLS, VSCODE_INSTALL } from "@/lib/agents";

export const metadata: Metadata = {
  title: "SwapChan for AI agents: MCP server + API",
  description:
    "Give your AI agent best-price same-chain and cross-chain swap quotes via SwapChan's MCP server and REST API.",
};

function Snippet({
  title,
  text,
  client,
  note,
}: {
  title: string;
  text: string;
  client: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-violet-500/40 bg-violet-950/70 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-black">{title}</h3>
        <CopyButton text={text} client={client} />
      </div>
      {note && <p className="mb-2 text-xs text-violet-300">{note}</p>}
      <pre className="overflow-x-auto rounded-lg bg-black/50 p-3 text-xs">{text}</pre>
    </div>
  );
}

export default function Agents() {
  return (
    <div className="w-full max-w-4xl">
      <section className="my-6 flex flex-col items-center gap-6 rounded-3xl border border-fuchsia-400/40 bg-gradient-to-br from-violet-900 to-fuchsia-900/70 p-6 text-center md:flex-row md:text-left">
        <div className="relative shrink-0">
          <img src="/characters/swapchan.png" alt="Swap-chan" width={180} height={180} />
          <span className="absolute -bottom-2 -right-2 text-5xl">💻</span>
        </div>
        <div>
          <h1 className="text-3xl font-black md:text-4xl">Your AI agent can swap too~</h1>
          <p className="mt-2 text-violet-200">
            Swap-chan asks every aggregator and bridge (0x, CoW, Velora, LI.FI, Across, Relay) and
            hands your agent the best route on any chain. One click to add:
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
            <InstallLink href={CURSOR_INSTALL} client="cursor">
              Add to Cursor
            </InstallLink>
            <InstallLink href={VSCODE_INSTALL} client="vscode">
              Add to VS Code
            </InstallLink>
            <CopyButton text={CONFIGS.claudeDesktop} client="claude" label="Copy Claude config" />
            <CopyButton text={CONFIGS.chatgpt} client="chatgpt" label="Copy ChatGPT URL" />
          </div>
          <p className="mt-3 font-mono text-sm text-amber-300">{MCP_URL}</p>
        </div>
      </section>

      <h2 className="mt-8 mb-3 text-2xl font-black">Tools</h2>
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

      <h2 className="mt-8 mb-3 text-2xl font-black">Setup</h2>
      <div className="grid gap-4">
        <Snippet title="Cursor (~/.cursor/mcp.json)" text={CONFIGS.cursor} client="cursor" />
        <Snippet title="VS Code (.vscode/mcp.json)" text={CONFIGS.vscode} client="vscode" />
        <Snippet
          title="Claude Desktop (claude_desktop_config.json)"
          text={CONFIGS.claudeDesktop}
          client="claude"
          note="Or Settings → Connectors → Add custom connector with the URL below."
        />
        <Snippet title="Claude Code" text={CONFIGS.claudeCode} client="claude-code" />
        <Snippet
          title="ChatGPT connector"
          text={CONFIGS.chatgpt}
          client="chatgpt"
          note="Settings → Connectors → Advanced → Developer mode → Create, paste this URL."
        />
      </div>

      <h2 id="rest-api" className="mt-8 mb-3 text-2xl font-black">
        REST API
      </h2>
      <p className="mb-3 text-violet-200">
        Same engine over HTTP at <code>{API_URL}</code>: <code>/chains</code>, <code>/tokens</code>,{" "}
        <code>/quotes</code>, <code>/quote</code> (best only), <code>/build</code>,{" "}
        <code>/status</code>. Amounts are in base units.
      </p>
      <Snippet title="Quote 100 USDC Ethereum → Base" text={CONFIGS.curl} client="curl" />
      <p className="mt-3 text-sm text-violet-300">
        Auth: open with fair rate limits today. For higher limits, ask for a key and send it as{" "}
        <code>x-api-key: &lt;key&gt;</code> (or <code>Authorization: Bearer &lt;key&gt;</code>) to
        both the API and the MCP server.
      </p>
    </div>
  );
}
