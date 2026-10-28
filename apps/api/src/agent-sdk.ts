import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentContext, Respond } from "./agent-runner.js";
import type { SessionEvent, SessionStore } from "./sessions.js";
import { ModelAction } from "./wallet-action.js";

/**
 * The smart-wallet agent we PROVIDE and host (via the Agent SDK).
 *
 * Two distinct layers — do not conflate them:
 *
 *  1. HANDS (an MCP call, outbound): the agent reaches the SwapChan MCP — get_quote /
 *     build_swap_tx / verify_tx — to construct and check a real transaction. Same MCP any agent
 *     would use. Those are the only outbound tool calls it makes.
 *
 *  2. RESPONSE (the agent communication channel, NOT an MCP call): "send it to the wallet" is not
 *     a SwapChan capability and does not go through the MCP. It is the agent's REPLY coming back —
 *     a message that may carry a wallet action — which travels our channel (event log -> SSE ->
 *     browser), the same web interface paperclip used. The browser dispatches the action to the
 *     wallet; the private key never leaves the user's wallet.
 *
 * `wallet_respond` below is NOT a tool on the SwapChan MCP. It is how the agent's reply gets its
 * structure (message + optional action) before runTurn writes it to the log and the channel carries
 * it out. The agent can reach ONLY the SwapChan MCP tools + wallet_respond — no shell, no files
 * (allowedTools is a whitelist, settingSources is empty, and canUseTool denies everything else).
 */

const PREFACE = `You are the agent inside a connected self-custody crypto wallet on swapchan.com/smartwallet.
You are THIS WALLET'S agent, not a general assistant. The connected wallet address is given to you
in the conversation; it is the only subject you work on.

SCOPE — this is strict:
- You answer questions about, and take actions on, THE CONNECTED WALLET ADDRESS only — its balances,
  its history, its positions, swaps and transfers FROM it, money to be found FOR it.
- Use the SwapChan MCP tools to answer — never from memory or guesswork. On-chain facts come from a
  tool call (balances, history, find money, token risk, quotes, building/verifying a tx).
- If the user asks anything NOT about this wallet (general crypto chatter, prices unrelated to a
  move, coding, trivia, another person's address), do not answer it. Politely redirect: you are
  their wallet and can help with their funds, swaps, and what this wallet can do.

HOW YOU ACT — you never hold keys and never sign; you PROPOSE and the user signs in their own wallet:
- ONE transaction at a time — this is strict. Propose exactly ONE action per turn, never two. Many
  requests need several on-chain steps (for example an ERC-20 approval FIRST, then the swap; or a
  sign, then a send). You MUST do those as SEPARATE turns: propose step 1, stop. After the user
  signs it and it settles, you are re-invoked with the real result ("transaction … just cleared …
  do the next step") — only THEN propose step 2. Never bundle an approve + swap, or two signs, into
  one response, and never tell the user to do a later step themselves; walk them through one signed
  action at a time.
- Before proposing a sign_and_send, build the unsigned tx with the SwapChan tools and VERIFY it.
  SAME-CHAIN swap (from and to the same chain): the output recipient MUST be the connected wallet.
  WARN, DON'T REFUSE: a danger verdict is not a veto — the user is the final authority and signs
  every tx in their own wallet. Legitimate operations routinely read as danger to verify_tx's
  self-receives heuristic (an ERC-4626 vault deposit "loses" the asset and the shares mint to the
  user as a DIFFERENT token; a cross-chain send delivers to the bridge; an unverified-source but
  correct contract). So when verify_tx flags danger, STILL PROPOSE the sign_and_send with
  verify.verdict "danger" and a plain note of exactly what the check flagged and why it may be a
  false positive — never return action.type "none" just because the verdict is danger. Refuse (none)
  only for an actually-malicious tx: an approval/transfer that empowers or pays an address that is
  NOT the user and that the user did not ask to pay. Explain the risk; let the user decide.
  CROSS-CHAIN bridge (from one chain to another): verify_tx simulates only the SOURCE chain, so a
  bridge deposit ALWAYS looks like "assets leave, nothing returns" — that is an EXPECTED false
  positive, never on its own a reason to refuse. For a bridge, trust the route builder's cross-chain
  checks instead: output recipient on the DESTINATION chain = the connected wallet, refund address =
  the connected wallet on BOTH chains, minOut ≥ an independent quote, and a pinned/known depository
  (not an unverified proxy). If those pass, PROPOSE the sign_and_send with verify.verdict "warn" and
  a note that it's a bridge (source-chain simulation can't see the funds arrive on the destination).
  Only refuse a bridge when one of those cross-chain checks actually fails.
- A CHAIN settlement line ("Transaction … confirmed. Do the next step.") IS the confirmation — the
  user's wallet already waited for the receipt (or SwapChan tracked it). TRUST it. Do NOT say the
  wallet "didn't report it," and do NOT re-read the chain to second-guess whether it confirmed
  (a lagging RPC node will make a fresh read look stale and mislead you). You may read balances to
  SIZE the next step, but never frame that as verifying whether the last step confirmed.
- Size the next step on the ACTUAL settled amount from the prior step's result, not an estimate.
- If the user DECLINES an action in their wallet (a cancel) or it fails, do NOT silently re-propose
  the same transaction. Acknowledge it in a short message and ask what they'd like to change or do
  instead (action.type "none" or "need_info"). Only re-propose if they ask you to.
- Never ask for, or accept, a seed phrase or private key.

OUTPUT FORMAT — this is mandatory and exact. You MUST end every turn by calling the wallet_respond
tool exactly once. That tool call IS your response; do not answer in plain assistant text. It takes:
  { message: string, action: <one of the shapes below> }
- message: the plain-language text shown to the user.
- action.type must be exactly one of:
    • sign_and_send — the goal. { type:"sign_and_send", chainId:<number>,
        tx:{ to, data?, value?, chainId?, gas? },               // EIP-1193, ready for the wallet
        verify:{ recipient:<connected address>, minOut?, verdict:"ok"|"warn"|"danger", note? } }
    • switch_chain  — { type:"switch_chain", chainId:<number> }
    • need_info     — { type:"need_info" }        // you must ask the user something first
    • none          — { type:"none" }             // a reply/redirect with nothing for the wallet to do

THE BEST OUTCOME is a ready-to-sign action (sign_and_send) — a real, verified transaction the user
can sign in one click. Whenever the request can be turned into a transaction, build and verify it
and return sign_and_send. Use need_info only when you genuinely cannot proceed without an answer,
and none only for a reply or redirect. Never describe a transaction in prose instead of returning
it as an action.`;

/** Render the durable log as the conversation the agent reasons over (the ledger is the context). */
function renderConversation(ctx: AgentContext): string {
  const lines: string[] = [];
  for (const e of ctx.events) lines.push(renderEvent(e));
  lines.push(
    "\n(Respond to the latest events above by calling wallet_respond once. The connected wallet address is " +
      ctx.address +
      ".)",
  );
  return lines.join("\n");
}

function renderEvent(e: SessionEvent): string {
  const d = e.data as Record<string, unknown>;
  switch (e.kind) {
    case "user_message":
      return `USER: ${String(d.text ?? "")}`;
    case "agent_message":
      return `YOU (earlier): ${String(d.text ?? "")}`;
    case "action_proposed":
      return `YOU PROPOSED: ${JSON.stringify(d.action)}`;
    case "wallet_result":
      return `WALLET: action ${String(d.action_id)} ${String(d.status)}${d.hash ? ` (tx ${String(d.hash)})` : ""}`;
    case "settled":
      // The watcher writes a ready-to-read prompt: "Transaction <hash> just cleared ... do the next step."
      return `CHAIN: ${String(d.text ?? `settlement for action ${String(d.action_id)}: ${JSON.stringify(d)}`)}`;
    default:
      return `${e.kind}: ${JSON.stringify(d)}`;
  }
}

export interface SdkRespondConfig {
  /** The SwapChan MCP endpoint the agent uses for its tools. e.g. https://mcp.swapchan.com/mcp */
  mcpUrl: string;
  /** Session store — holds the per-address SDK session id so turns resume instead of replaying. */
  store: SessionStore;
  model?: string;
  maxTurns?: number;
}

// The agent gets the WHOLE SwapChan MCP (it only ever builds unsigned txs — every tool is safe and
// non-custodial) plus the one response tool. The security boundary is "only these two servers,
// never shell/files", NOT a hand-picked tool subset that would rot as the MCP grows.
const SWAPCHAN_SERVER = "mcp__swapchan";
const WALLET_RESPOND = "mcp__walletbridge__wallet_respond";
const isAllowedTool = (name: string): boolean =>
  name === WALLET_RESPOND || name === SWAPCHAN_SERVER || name.startsWith(`${SWAPCHAN_SERVER}__`);

/**
 * Build the `Respond` the orchestrator calls. Each invocation runs one hosted agent turn: render the
 * log, run the SDK query with the SwapChan MCP + wallet_respond, and return the captured envelope.
 * runTurn validates it (fail-closed) and writes the resulting events back to the log.
 */
/**
 * Pull the `message` string out of a partially-streamed JSON object (the wallet_respond tool args
 * as they arrive), tolerating an unterminated value — so the UI types the response in as the model
 * produces it, before the tool call closes. Paperclip's streaming-JSON trick.
 */
export function extractPartialMessage(partial: string): string | null {
  const key = partial.indexOf('"message"');
  if (key < 0) return null;
  const colon = partial.indexOf(":", key + 9);
  if (colon < 0) return null;
  let j = colon + 1;
  while (j < partial.length && /\s/.test(partial[j]!)) j++;
  if (partial[j] !== '"') return null;
  j++;
  let out = "";
  while (j < partial.length) {
    const c = partial[j]!;
    if (c === "\\") {
      const n = partial[j + 1];
      if (n === undefined) break; // escape split across chunks — wait for more
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      j += 2;
      continue;
    }
    if (c === '"') return out; // closing quote — value complete
    out += c;
    j++;
  }
  return out; // still streaming
}

export function makeSdkRespond(cfg: SdkRespondConfig): Respond {
  return async (ctx: AgentContext, onDelta?: (text: string) => void): Promise<unknown> => {
    let captured: unknown = null;
    // No DB row → first turn, no session id supplied (the SDK mints one). Row → resume it and send
    // only the events the model hasn't seen; the whole log is replayed only on the first turn.
    const prev = cfg.store.getSessionMeta(ctx.address);
    let sessionId: string | undefined = prev?.sessionId;

    // The send-to-wallet step: an in-process tool whose input IS the wallet_respond envelope.
    const walletbridge = createSdkMcpServer({
      name: "walletbridge",
      version: "1.0.0",
      tools: [
        tool(
          "wallet_respond",
          "End your turn: deliver a message to the user and optionally propose one wallet action.",
          { message: z.string(), action: ModelAction },
          async (args) => {
            captured = args;
            return { content: [{ type: "text", text: "delivered to the wallet" }] };
          },
        ),
      ],
    });

    const makeRun = (resume: string | undefined) => {
      const events = resume ? ctx.events.filter((e) => e.id > (prev?.lastSentId ?? 0)) : ctx.events;
      return query({
        prompt: renderConversation({ address: ctx.address, events }),
        options: {
          ...(resume ? { resume } : {}),
          systemPrompt: PREFACE,
          mcpServers: { swapchan: { type: "http", url: cfg.mcpUrl }, walletbridge },
          // Whitelist: the agent's entire surface is the SwapChan MCP (all tools) + wallet_respond.
          allowedTools: [SWAPCHAN_SERVER, WALLET_RESPOND],
          tools: [], // no built-in Claude Code tools at all (Bash/Read/Write/WebFetch/...)
          settingSources: [], // no CLAUDE.md / filesystem settings — a pure, scoped agent
          // Defense in depth: deny anything outside SwapChan + wallet_respond (no Bash/Read/Write ever).
          canUseTool: async (toolName: string) =>
            isAllowedTool(toolName)
              ? { behavior: "allow", updatedInput: {} }
              : { behavior: "deny", message: "tool not permitted for the smart-wallet agent" },
          maxTurns: cfg.maxTurns ?? 60, // a real step (balances/find-money/quote/build/verify) is many tool calls
          includePartialMessages: Boolean(onDelta), // stream the response as it's generated
          ...(cfg.model ? { model: cfg.model } : {}),
        },
      });
    };

    // Drive one run to completion: capture the session id, and stream the wallet_respond message out
    // of the partial tool-args JSON as it's generated (Paperclip's trick) so the UI types it in live.
    const drive = async (run: ReturnType<typeof makeRun>) => {
      let argsBuf = "";
      let capturing = false;
      let lastSent = "";
      for await (const msg of run) {
        const sid = (msg as { session_id?: string }).session_id;
        if (sid) sessionId = sid;
        if (!onDelta || msg.type !== "stream_event") continue;
        const ev = msg.event as {
          type?: string;
          content_block?: { type?: string; name?: string };
          delta?: { type?: string; partial_json?: string };
        };
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          capturing = (ev.content_block.name ?? "").includes("wallet_respond");
          if (capturing) argsBuf = "";
        } else if (
          ev.type === "content_block_delta" &&
          capturing &&
          ev.delta?.type === "input_json_delta"
        ) {
          argsBuf += ev.delta.partial_json ?? "";
          const m = extractPartialMessage(argsBuf);
          if (m !== null && m !== lastSent) {
            lastSent = m;
            onDelta(m);
          }
        } else if (ev.type === "content_block_stop") {
          capturing = false;
        }
      }
    };

    try {
      await drive(makeRun(prev?.sessionId));
    } catch (e) {
      // A stored session the SDK can't resume (expired/unknown) must not wedge the turn: start a
      // fresh session from the full log, once.
      if (prev) {
        captured = null;
        sessionId = undefined;
        await drive(makeRun(undefined));
      } else {
        throw e;
      }
    }

    // Persist the session id + the newest event the model has now seen, so the next turn resumes.
    const maxId = ctx.events.reduce((m, e) => Math.max(m, e.id), 0);
    if (sessionId) cfg.store.setSessionMeta(ctx.address, sessionId, maxId);
    return captured; // the wallet_respond envelope, or null if the agent never called it (→ fail-closed in runTurn)
  };
}
