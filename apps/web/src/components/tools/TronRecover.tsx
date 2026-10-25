"use client";

import { Fragment, useState } from "react";
import { SpeechBubble } from "@/components/Character";
import { signCheckedTron, tronNodeRequest, useTron } from "@/lib/tron";
import { RECOVER_TYPE } from "@/lib/tronCheck";

/** Must match apps/api/src/tronrecover.ts: self-paying Tron ops only. */
const OPS = [
  "withdrawbalance",
  "withdrawexpireunfreeze",
  "unfreezebalancev2",
  "unfreezebalance",
  "undelegateresource",
  "triggersmartcontract",
];
const KEEP = [
  "owner_address",
  "resource",
  "unfreeze_balance",
  "receiver_address",
  "balance",
  "contract_address",
  "data",
  "call_value",
];
const SEL: Record<string, string> = {
  "2e1a7d4d": "withdraw(uint256)",
  db006a75: "redeem(uint256)",
  d1058e59: "claimAll()",
};
export type TronSpec = { endpoint: string; body: Record<string, unknown> };

export function checkSpec(s: TronSpec, me?: string): string | null {
  if (!OPS.includes(s.endpoint)) return "unknown Tron operation";
  if (Object.keys(s.body).some((k) => !KEEP.includes(k))) return "unexpected field";
  if (me && s.body.owner_address !== me)
    return "this is for a different wallet than the connected Tron wallet";
  if (s.endpoint === "triggersmartcontract") {
    const d = String(s.body.data ?? "");
    if (Number(s.body.call_value ?? 0) !== 0) return "sends TRX";
    if (!SEL[d.slice(0, 8)] || (d.length !== 8 && d.length !== 72))
      return "unrecognised contract call";
  }
  return null;
}

export function TronRecover(p: { spec: TronSpec; title: string; next?: string }) {
  const tron = useTron(true);
  const [txid, setTxid] = useState<string>();
  const [err, setErr] = useState<string>();
  const bad = checkSpec(p.spec, tron.address);
  const d = String(p.spec.body.data ?? "");
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="tron-recover">
      <SpeechBubble who="swapchan">
        {txid
          ? "Yay, it's back in your wallet! Now let's turn it into USDC, senpai!"
          : "Step 1: sign this in your Tron wallet to pull your TRX out. Step 2: swap it to USDC."}
      </SpeechBubble>
      <div className="rounded-2xl border-2 border-violet-600 bg-violet-950 p-4 text-sm">
        <p className="text-xs font-bold text-violet-300">Step 1 of 2 · recover (Tron)</p>
        <h1 className="text-xl font-black">{p.title}</h1>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs break-all">
          <dt className="text-violet-400">operation</dt>
          <dd data-testid="op">
            {p.spec.endpoint}
            {SEL[d.slice(0, 8)] ? ` · ${SEL[d.slice(0, 8)]}` : ""}
          </dd>
          {Object.entries(p.spec.body).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-violet-400">{k}</dt>
              <dd>{String(v)}</dd>
            </Fragment>
          ))}
        </dl>
        {bad && <p className="mt-2 font-bold text-rose-300">Won't sign: {bad}.</p>}
        <div className="mt-3">
          {!tron.address ? (
            <button
              type="button"
              onClick={tron.open}
              className="rounded-lg border-2 border-violet-950 bg-amber-400 px-4 py-2 font-black text-violet-950"
            >
              Connect Tron wallet
            </button>
          ) : (
            <button
              type="button"
              disabled={!!bad || !!txid}
              onClick={async () => {
                setErr(undefined);
                try {
                  const trig = p.spec.endpoint === "triggersmartcontract";
                  const r = await tronNodeRequest(`wallet/${p.spec.endpoint}`, {
                    ...p.spec.body,
                    ...(trig ? { fee_limit: 150_000_000 } : {}),
                    visible: true,
                  });
                  const tx = trig ? r?.transaction : r;
                  if (!tx?.raw_data)
                    throw new Error(
                      r?.Error ?? r?.result?.message ?? "TronGrid could not build the tx",
                    );
                  const type = RECOVER_TYPE[p.spec.endpoint];
                  if (!type || !tron.address) throw new Error("unknown Tron operation");
                  // Exactly the op we showed: same contract type, owner and every field of the spec.
                  const value = Object.fromEntries(
                    Object.entries(p.spec.body).map(([k, v]) => [
                      k,
                      typeof v === "number" ? v : String(v),
                    ]),
                  );
                  setTxid(
                    await signCheckedTron(tx, {
                      owner: tron.address,
                      type,
                      value,
                      ...(trig ? { feeLimitMax: 150_000_000 } : {}),
                    }),
                  );
                } catch (e) {
                  setErr((e as Error).message.split("\n")[0]);
                }
              }}
              className="rounded-lg border-2 border-violet-950 bg-amber-400 px-4 py-2 font-black text-violet-950 disabled:opacity-50"
            >
              {txid ? "Signed ✓" : "Sign recovery in your wallet"}
            </button>
          )}
        </div>
        {txid && <p className="mt-2 font-mono text-xs break-all">tx {txid}</p>}
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
        You sign in your own Tron wallet; SwapChan never holds your keys or funds. The tx is rebuilt
        fresh because Tron txs expire in a minute.
      </p>
    </div>
  );
}
