"use client";

import type { StatusResponse } from "@swapchan/shared";
import { useQuery } from "@tanstack/react-query";
import { useWaitForTransactionReceipt } from "wagmi";
import { api } from "@/lib/api";
import { characterForChain } from "@/lib/characters";
import { Character } from "./Character";
import { HopAnimation } from "./HopAnimation";

export interface TrackParams {
  provider: string;
  txHash: `0x${string}`;
  fromChainId: number;
  toChainId: number;
  mocked: boolean;
}

const LABEL: Record<StatusResponse["status"], string> = {
  pending: "In flight",
  done: "Arrived!",
  failed: "Failed",
  not_found: "Looking for your transaction…",
};

export function StatusTracker({ p, onReset }: { p: TrackParams; onReset?: () => void }) {
  const cross = p.fromChainId !== p.toChainId;
  const receipt = useWaitForTransactionReceipt({
    hash: p.txHash,
    chainId: p.fromChainId,
    query: { enabled: !p.mocked },
  });
  const status = useQuery({
    queryKey: ["status", p],
    queryFn: () =>
      api.status(
        {
          provider: p.provider,
          txHash: p.txHash,
          fromChainId: p.fromChainId,
          toChainId: p.toChainId,
        },
        p.mocked,
      ),
    enabled: cross || p.mocked,
    refetchInterval: (q) =>
      q.state.data?.status === "done" || q.state.data?.status === "failed" ? false : 3000,
  });

  const state: StatusResponse["status"] =
    cross || p.mocked
      ? (status.data?.status ?? "pending")
      : receipt.data
        ? receipt.data.status === "success"
          ? "done"
          : "failed"
        : receipt.isError
          ? "failed"
          : "pending";

  const dest = characterForChain(p.toChainId);
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="status-tracker">
      {state === "done" ? (
        <>
          <div className="flex items-end gap-2">
            <Character who="swapchan" size={110} mood="cheer" />
            <Character who={dest.key} size={80} mood="cheer" />
          </div>
          <h3 className="text-2xl font-black text-amber-300">Yatta! Swap complete ✨</h3>
        </>
      ) : state === "failed" ? (
        <>
          <Character who="swapchan" size={110} mood="sad" />
          <h3 className="text-xl font-black text-rose-400">Gomen… the swap failed.</h3>
        </>
      ) : (
        <>
          <HopAnimation
            steps={[
              {
                type: cross ? "bridge" : "swap",
                tool: p.provider,
                fromChainId: p.fromChainId,
                toChainId: p.toChainId,
                fromToken: "0x0",
                toToken: "0x0",
                fromAmount: "0",
                toAmount: "0",
              },
            ]}
          />
          <h3 className="animate-pulse text-xl font-black">{LABEL[state]}</h3>
          <p className="text-sm text-violet-300">
            {cross ? `${dest.name} is waiting to catch your tokens.` : "Waiting for confirmation…"}
          </p>
        </>
      )}
      <ol className="w-full max-w-sm space-y-1 text-left text-xs text-violet-300">
        <li>
          ✔ Signed &amp; sent: <code className="break-all">{p.txHash}</code>
        </li>
        {cross && (
          <li>
            {state === "done" ? "✔" : "…"} Bridged via {p.provider}
          </li>
        )}
        {status.data?.receivingTxHash && (
          <li>
            ✔ Received: <code className="break-all">{status.data.receivingTxHash}</code>
          </li>
        )}
        {p.mocked && (
          <li className="text-amber-300">(demo mode: simulated, nothing sent on-chain)</li>
        )}
      </ol>
      {onReset && (state === "done" || state === "failed") && (
        <button
          type="button"
          onClick={onReset}
          className="rounded-full bg-violet-700 px-4 py-2 font-bold hover:bg-violet-600"
        >
          Swap again
        </button>
      )}
    </div>
  );
}
