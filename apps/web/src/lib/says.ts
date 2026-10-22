import type { Quote, Token } from "@swapchan/shared";
import { useSyncExternalStore } from "react";
import { formatAmount } from "./amount";

/** Everything Swap-chan reacts to, published by the swap box. */
export interface SwapState {
  amount: string;
  amountInvalid: boolean;
  fromToken?: Token;
  toToken?: Token;
  fromChainName: string;
  toChainName: string;
  connected: boolean;
  wrongNetwork: boolean;
  insufficient: boolean;
  quoting: boolean;
  error?: string;
  quotes?: Quote[];
  best?: string | null;
  phase: "idle" | "approving" | "swapping" | "tracking" | "order" | "error";
  phaseError?: string;
  /** Set by the status tracker once the swap settles. */
  settled?: "done" | "failed";
}

export interface Says {
  mood: "idle" | "think" | "cheer" | "sad" | "bounce";
  text: string;
  warn?: string;
}

export const isUnverified = (t?: Token): boolean =>
  !!t && (t as Token & { verified?: boolean }).verified === false;

export function unverifiedWarning(s: Pick<SwapState, "fromToken" | "toToken">): string | undefined {
  const bad = [s.fromToken, s.toToken].filter(isUnverified).map((t) => t?.symbol);
  return bad.length
    ? `${bad.join(" & ")} ${bad.length > 1 ? "aren't" : "isn't"} on my list. Double-check the address, senpai!`
    : undefined;
}

/** Short, in-character line for the current swap state. Pure, so it's easy to test. */
export function say(s: SwapState): Says {
  const warn = unverifiedWarning(s);
  const from = s.fromToken?.symbol ?? "???";
  const to = s.toToken?.symbol ?? "???";
  const where =
    s.fromChainName === s.toChainName
      ? `on ${s.fromChainName}`
      : `${s.fromChainName} → ${s.toChainName}`;
  const r = (x: Says): Says => (warn ? { ...x, warn } : x);

  if (s.phase === "approving")
    return r({ mood: "think", text: `Approving ${from}… check your wallet!` });
  if (s.phase === "swapping")
    return r({ mood: "think", text: "Sign it in your wallet and I'll take it from here~" });
  if (s.phase === "tracking" && s.settled === "done")
    return r({
      mood: "cheer",
      text: `Yatta~! Your ${to} landed on ${s.toChainName}! ✨ High five, senpai!`,
    });
  if (s.phase === "tracking" && s.settled === "failed")
    return r({
      mood: "sad",
      text: "Gomen… that one failed. Check the explorer link; bridges refund.",
    });
  if (s.phase === "tracking")
    return r({ mood: "bounce", text: `Your ${to} is on its way ${where}! Hang tight~` });
  if (s.phase === "order")
    return r({
      mood: "cheer",
      text: "Order's in! The CoW solvers are fighting over it. No gas for you~",
    });
  if (s.phase === "error")
    return r({ mood: "sad", text: `Gomen… ${s.phaseError ?? "that didn't work"}. Try again?` });

  if (s.amountInvalid)
    return r({ mood: "sad", text: `${from} can't have that many decimals, silly!` });
  if (!s.amount || Number(s.amount) === 0)
    return r({
      mood: "idle",
      text: `Type how much ${from} to swap ${where} and I'll ask everyone!`,
    });
  if (s.quoting && !s.quotes?.length)
    return r({
      mood: "think",
      text: `Asking every aggregator and bridge about ${s.amount} ${from} → ${to} ${where}…`,
    });
  if (s.error) return r({ mood: "sad", text: `Uwaa, the quote service tripped: ${s.error}` });
  if (s.quotes && s.quotes.length === 0)
    return r({
      mood: "sad",
      text: `Nobody will route ${from} → ${to} ${where} right now. Try another amount or token?`,
    });

  const q = s.quotes ?? [];
  const best = q.find((x) => x.id === s.best) ?? q[0];
  if (!best || !s.toToken) return r({ mood: "think", text: "Thinking…" });
  const dec = s.toToken.decimals;
  const amt = formatAmount(best.toAmount, dec, 4);
  let edge = "";
  if (q.length > 1) {
    const worst = q.reduce((m, x) => (BigInt(x.toAmount) < BigInt(m.toAmount) ? x : m));
    const diff = BigInt(best.toAmount) - BigInt(worst.toAmount);
    if (diff > 0n) edge = ` That's ${formatAmount(diff, dec, 4)} ${to} more than the worst.`;
  }
  const head = `${q.length} route${q.length > 1 ? "s" : ""}! ${best.provider} wins: ${amt} ${to}.${edge}`;
  if (!s.connected) return r({ mood: "cheer", text: `${head} Connect your wallet to grab it~` });
  if (s.wrongNetwork)
    return r({ mood: "bounce", text: `${head} Switch your wallet to ${s.fromChainName} first!` });
  if (s.insufficient)
    return r({ mood: "sad", text: `${head} …but you don't have enough ${from}.` });
  return r({ mood: "cheer", text: `${head} Ready when you are, senpai!` });
}

// Tiny store so the greeting beside the swap box can follow the swap box.
let current: Says | null = null;
const subs = new Set<() => void>();
export const publishSays = (s: Says) => {
  if (current && current.text === s.text && current.warn === s.warn && current.mood === s.mood)
    return;
  current = s;
  for (const f of subs) f();
};
export const useSays = (): Says | null =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => null,
  );
