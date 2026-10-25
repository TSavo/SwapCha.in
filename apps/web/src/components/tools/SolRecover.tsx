"use client";

import { useState } from "react";
import { SpeechBubble } from "@/components/Character";
import { toSolanaTx } from "@/lib/solana";
import { useSolana } from "@/lib/useSolana";

/** Must match apps/api/src/solrecover.ts: allowlisted programs, owner is the only signer, money goes to owner. */
const STAKE = "Stake11111111111111111111111111111111111111";
const MARINADE = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD";
const MSTATE = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";
const MRESERVE = "Du3Ysj1wKbxPKkuPPnvzQLQh8oMSVifs3jGZjJWXFmHN";
const MCLAIM = "3ec6d6c1d59f6cd2";
export type SolIx = { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
export type SolSpec = { owner: string; ix: SolIx[] };

export function checkSol(s: SolSpec, me?: string): string | null {
  if (!s.ix?.length) return "empty";
  if (me && s.owner !== me) return "this is for a different wallet than the connected one";
  for (const ix of s.ix) {
    if (ix.keys.some((k) => k.isSigner && k.pubkey !== s.owner)) return "asks for another signer";
    if (ix.programId === STAKE) {
      if (!ix.data.startsWith("04000000") || ix.data.length !== 24) return "only stake Withdraw is allowed";
      if (ix.keys[1]?.pubkey !== s.owner || ix.keys[3]?.pubkey !== s.owner) return "withdraw is not to your wallet";
    } else if (ix.programId === MARINADE) {
      if (ix.data !== MCLAIM) return "only Marinade claim is allowed";
      if (ix.keys[0]?.pubkey !== MSTATE || ix.keys[1]?.pubkey !== MRESERVE || ix.keys[3]?.pubkey !== s.owner) return "claim is not to your wallet";
    } else return "program not allowlisted";
  }
  return null;
}

const NAME: Record<string, string> = { [STAKE]: "Stake program · Withdraw", [MARINADE]: "Marinade · claim ticket" };

export function SolRecover(p: { spec: SolSpec; title: string; next?: string }) {
  const sol = useSolana();
  const [sig, setSig] = useState<string>();
  const [err, setErr] = useState<string>();
  const bad = checkSol(p.spec, sol.address);
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="sol-recover">
      <SpeechBubble who="swapchan">
        {sig ? "It's back in your wallet! Now let's swap it, senpai!" : "Step 1: sign this in your Solana wallet to pull your SOL out. Step 2: swap it to USDC."}
      </SpeechBubble>
      <div className="rounded-2xl border-2 border-violet-600 bg-violet-950 p-4 text-sm">
        <p className="text-xs font-bold text-violet-300">Step 1 of 2 · recover (Solana)</p>
        <h1 className="text-xl font-black">{p.title}</h1>
        <ul className="mt-2 font-mono text-xs break-all">
          {p.spec.ix.map((ix, i) => (
            <li key={i}>{NAME[ix.programId] ?? ix.programId} · to {p.spec.owner}</li>
          ))}
        </ul>
        {bad && <p className="mt-2 font-bold text-rose-300">Won&apos;t sign: {bad}.</p>}
        <div className="mt-3">
          {!sol.address ? (
            <button type="button" onClick={sol.open} className="rounded-lg border-2 border-violet-950 bg-amber-400 px-4 py-2 font-black text-violet-950">Connect Solana wallet</button>
          ) : (
            <button
              type="button"
              disabled={!!bad || !!sig}
              onClick={async () => {
                setErr(undefined);
                try {
                  if (!sol.provider || !sol.connection) throw new Error("Solana wallet not ready");
                  const tx = await toSolanaTx({ kind: "svm-instructions", data: { instructions: p.spec.ix } } as never, p.spec.owner, sol.connection);
                  setSig(await sol.provider.signAndSendTransaction(tx));
                } catch (e) {
                  setErr((e as Error).message.split("\n")[0]);
                }
              }}
              className="rounded-lg border-2 border-violet-950 bg-amber-400 px-4 py-2 font-black text-violet-950 disabled:opacity-50"
            >
              {sig ? "Signed ✓" : "Sign recovery in your wallet"}
            </button>
          )}
        </div>
        {sig && <p className="mt-2 font-mono text-xs break-all">tx {sig}</p>}
        {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
      </div>
      {p.next && (
        <a href={p.next} data-testid="next" className="rounded-2xl border-2 border-emerald-500 bg-emerald-950 p-4 font-bold">Step 2 of 2 · swap it to USDC on SwapChan →</a>
      )}
    </div>
  );
}
