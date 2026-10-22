import Link from "next/link";
import { CONFIGS, CURSOR_INSTALL, VSCODE_INSTALL } from "@/lib/agents";
import { CopyButton, InstallLink } from "./CopyButton";

/** Top-of-home call to action: add SwapChan's MCP server to your AI agent. */
export function AgentBanner() {
  return (
    <div className="mb-4 flex w-full max-w-5xl flex-col items-center gap-3 rounded-2xl border border-fuchsia-400/40 bg-gradient-to-r from-violet-900/80 to-fuchsia-900/60 p-4 sm:flex-row sm:justify-between">
      <div className="flex items-center gap-3">
        <img src="/characters/swapchan.png" alt="" width={48} height={48} />
        <div>
          <div className="font-black">🤖 Add SwapChan to your AI agent</div>
          <div className="text-xs text-violet-300">
            Your agent gets best-price quotes on every chain via MCP.{" "}
            <Link href="/agents" className="underline hover:text-amber-300">
              Details →
            </Link>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <InstallLink href={CURSOR_INSTALL} client="cursor">
          Add to Cursor
        </InstallLink>
        <InstallLink href={VSCODE_INSTALL} client="vscode">
          Add to VS Code
        </InstallLink>
        <CopyButton text={CONFIGS.claudeDesktop} client="claude" label="Claude config" />
        <CopyButton text={CONFIGS.chatgpt} client="chatgpt" label="ChatGPT URL" />
      </div>
    </div>
  );
}
