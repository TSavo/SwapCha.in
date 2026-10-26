import Link from "next/link";
import { BtPage, btMeta } from "@/components/blocktools/BtPage";
import { CopyCode } from "@/components/blocktools/CopyCode";
import { CONFIGS, MCP_URL } from "@/lib/agents";
import { DEV_TOOLS } from "@/lib/devTools";

export const metadata = btMeta(
  "/blocktools/mcp",
  "blocktools for AI agents (MCP)",
  "Give an AI agent blocktools' public chain tools through SwapChan's MCP server: address checks, conversions, decoders and transaction verification. No keys, no signing.",
);

export default function Mcp() {
  const mcpTools = [...new Set(DEV_TOOLS.map((t) => t.mcp))];
  return (
    <BtPage
      title="MCP: blocktools for AI agents"
      lead={
        <p>
          blocktools itself is a CLI. SwapChan runs its wasm build on a server and exposes the
          public, key-free parts over MCP, so an agent can check addresses, decode transactions and
          verify before signing. It never sees keys and never signs.
        </p>
      }
    >
      <h2 className="mb-2 text-xl font-black">Connect</h2>
      <p className="mb-2 text-sm text-violet-300">
        Streamable HTTP, no API key: <code>{MCP_URL}</code>
      </p>
      <CopyCode label="Claude Code" code={CONFIGS.claudeCode} />
      <div className="mt-3">
        <CopyCode label="Cursor (mcp.json)" code={CONFIGS.cursor} />
      </div>
      <p className="mt-2 text-sm">
        <Link href="/agents" className="underline">
          Setup for every client
        </Link>
      </p>
      <h2 className="mt-8 mb-2 text-xl font-black">Tools that run on blocktools</h2>
      <ul className="flex flex-wrap gap-2">
        {mcpTools.map((m) => (
          <li key={m} className="rounded-md bg-black/40 px-2 py-1 font-mono text-sm text-amber-200">
            {m}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-violet-300">Each one has a web page too:</p>
      <ul className="mt-2 flex flex-wrap gap-2 text-sm">
        {DEV_TOOLS.map((t) => (
          <li key={t.slug}>
            <Link href={`/tools/${t.slug}`} className="underline">
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="mt-8 mb-2 text-xl font-black">Anything with a secret: use the CLI</h2>
      <p className="text-sm">
        Seeds, keys, wallet files and signing stay on your machine, in a sealed{" "}
        <code>./blocktools run</code>.{" "}
        <Link href="/blocktools/install" className="underline">
          Install the CLI
        </Link>
        .
      </p>
    </BtPage>
  );
}
