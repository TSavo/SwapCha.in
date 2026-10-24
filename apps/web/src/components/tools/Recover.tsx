"use client";

import { useState } from "react";
import { decodeFunctionData, formatEther, parseAbi } from "viem";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { SpeechBubble } from "@/components/Character";
import { ConnectButton } from "@/components/ConnectButton";

const ABI = parseAbi([
  "function withdraw()",
  "function exit()",
  "function getReward()",
  "function claim()",
  "function claimRewards()",
  "function withdraw(uint256 amount)",
  "function redeem(uint256 shares, address receiver, address owner)",
  "function withdrawToken(address token, uint256 amount)",
  "function claimComp(address holder)",
  "function claimVenus(address holder)",
  "function claimWithdrawal(uint256 requestId)",
  "function claimCollateral()",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params)",
]);
const CHAINS: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  10: "Optimism",
  42161: "Arbitrum",
  137: "Polygon",
  56: "BNB Chain",
  43114: "Avalanche",
};
const show = (v: unknown): string =>
  typeof v === "bigint"
    ? v.toString()
    : typeof v === "object" && v
      ? JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))
      : String(v);

export function Recover(p: {
  chain: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  title: string;
  next?: string;
}) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [hash, setHash] = useState<string>();
  const [err, setErr] = useState<string>();
  let call: { functionName: string; args?: readonly unknown[] } | undefined;
  try {
    call = decodeFunctionData({ abi: ABI, data: p.data });
  } catch {}
  const safe = !!call && p.value === "0";
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="recover">
      <div className="flex items-end gap-3">
        <SpeechBubble who="swapchan">
          {hash
            ? "Yay, it's back in your wallet! Now let's turn it into USDC, senpai!"
            : "I found your money, senpai! Step 1: sign this to pull it out. Step 2: I swap it to USDC."}
        </SpeechBubble>
      </div>
      <div className="rounded-2xl border-2 border-violet-600 bg-violet-950 p-4 text-sm">
        <p className="text-xs font-bold text-violet-300">Step 1 of 2 · recover</p>
        <h1 className="text-xl font-black">{p.title}</h1>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs break-all">
          <dt className="text-violet-400">chain</dt>
          <dd data-testid="chain">
            {CHAINS[p.chain] ?? p.chain} ({p.chain})
          </dd>
          <dt className="text-violet-400">to</dt>
          <dd data-testid="to">{p.to}</dd>
          <dt className="text-violet-400">call</dt>
          <dd data-testid="call">
            {call
              ? `${call.functionName}(${(call.args ?? []).map(show).join(", ")})`
              : "unrecognised calldata"}
          </dd>
          <dt className="text-violet-400">value</dt>
          <dd>{formatEther(BigInt(p.value || "0"))} (sends nothing)</dd>
          <dt className="text-violet-400">data</dt>
          <dd data-testid="data">{p.data}</dd>
        </dl>
        {!safe && (
          <p className="mt-2 font-bold text-rose-300">
            I don't recognise this call as a withdraw-to-you, so I won't let you sign it here.
          </p>
        )}
        {call?.functionName === "redeem" &&
          address &&
          (call.args?.[1] as string)?.toLowerCase() !== address.toLowerCase() && (
            <p className="mt-2 font-bold text-rose-300">
              This redeem pays someone other than the connected wallet. Don't sign.
            </p>
          )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!address ? (
            <ConnectButton />
          ) : (
            <button
              type="button"
              disabled={!safe || !!hash}
              onClick={async () => {
                setErr(undefined);
                try {
                  if (chainId !== p.chain) await switchChainAsync({ chainId: p.chain });
                  setHash(await sendTransactionAsync({ to: p.to, data: p.data, value: 0n }));
                } catch (e) {
                  setErr((e as Error).message.split("\n")[0]);
                }
              }}
              className="rounded-lg border-2 border-violet-950 bg-amber-400 px-4 py-2 font-black text-violet-950 disabled:opacity-50"
            >
              {hash ? "Signed ✓" : "Sign recovery in my wallet"}
            </button>
          )}
        </div>
        {hash && <p className="mt-2 font-mono text-xs break-all">tx {hash}</p>}
        {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
      </div>
      {p.next && (
        <a
          href={p.next}
          data-testid="next"
          className="rounded-2xl border-2 border-emerald-500 bg-emerald-950 p-4 font-bold"
        >
          Step 2 of 2 · swap it to USDC on SwapChan →
        </a>
      )}
      <p className="text-xs text-violet-400">
        You sign in your own wallet; SwapChan never holds your keys or funds. The call is decoded
        above so you can check it first.
      </p>
    </div>
  );
}
