"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { asOfLine, type Freshness } from "@/lib/asOf";
import type { TxCall } from "@/lib/callSummary";
import { TxCallBox } from "./TxCallBox";

type Step = {
  step: number;
  kind: string;
  label: string;
  url?: string | null;
  shortUrl?: string | null;
  call?: TxCall;
};
type Item = {
  rank?: number;
  wallet?: string;
  walletLabel?: string;
  category?: string;
  title: string;
  estUsd: number | null;
  estimateKind?: string;
  detail?: string;
  action?: string;
  steps?: Step[];
};
type Result = Freshness & {
  totalEstUsd?: number;
  atRiskUsd?: number;
  items: Item[];
  headline?: string;
  owedNotClaimableNow?: { protocol: string; owed: string | null; reason: string; link?: string }[];
  progress?: { done: number; total: number; percent: number };
  status?: string;
  errors?: unknown[];
};

const usd = (n: number | null | undefined) =>
  n == null ? "?" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const ADDR =
  /(0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|bc1[a-z0-9]{25,62}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|[1-9A-HJ-NP-Za-km-z]{32,44}|[a-z0-9-]+\.(?:eth|sol))/g;

/** The live find_money tool: one address (GET /onchain/money) or many (POST /onchain/money/batch, polled). */
export function FindMoneyTool() {
  const sp = useSearchParams();
  const [text, setText] = useState(sp.get("address") ?? "");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  async function scan(input = text, fresh = false) {
    const n = (input.match(ADDR) ?? []).length;
    if (!n) return setErr("Paste at least one wallet address or ENS name.");
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      if (n === 1 && !input.trim().includes("\n")) {
        const a = (input.match(ADDR) ?? [])[0]!;
        const r = await fetch(
          `${API_URL}/onchain/money?address=${encodeURIComponent(a)}${fresh ? "&fresh=1" : ""}`,
        );
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setRes(j);
      } else {
        const r = await fetch(`${API_URL}/onchain/money/batch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addresses: input }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        for (;;) {
          const s = await (await fetch(`${API_URL}/onchain/money/batch/${j.jobId}`)).json();
          setRes(s);
          if (s.status === "done") break;
          await new Promise((ok) => setTimeout(ok, 3000));
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const a = sp.get("address");
    if (a && !started.current) {
      started.current = true;
      void scan(a);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const items = res?.items ?? [];
  const exact = items
    .filter((i) => i.estimateKind === "exact")
    .reduce((s, i) => s + (i.estUsd ?? 0), 0);
  return (
    <section
      data-testid="find-money-tool"
      className="rounded-2xl border-2 border-violet-700 bg-violet-950 p-4"
    >
      <label htmlFor="fm-in" className="mb-1 block font-bold">
        Wallet addresses (one per line, any chain; words after an address become its label)
      </label>
      <textarea
        id="fm-in"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"0x… or name.eth\nmy-ledger TUEZ…\nbc1q…"}
        className="w-full rounded-xl border-2 border-violet-700 bg-violet-900 p-2 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => void scan()}
        disabled={busy}
        className="mt-2 rounded-xl bg-amber-300 px-4 py-2 font-black text-violet-950 disabled:opacity-50"
      >
        {busy ? "Scanning… (about 20s per wallet)" : "Find my money"}
      </button>
      <p className="mt-1 text-xs text-violet-300">
        Read-only. SwapChan never asks for keys or seed phrases and cannot move funds.
      </p>
      {err && <p className="mt-2 text-red-300">{err}</p>}
      {res && (
        <div className="mt-4" data-testid="find-money-result">
          {res.progress && res.status !== "done" && (
            <p className="text-sm">
              Scanned {res.progress.done}/{res.progress.total} wallets…
            </p>
          )}
          {asOfLine(res) && (
            <p className="text-xs text-violet-300" data-testid="find-money-asof">
              {asOfLine(res)}{" "}
              <button
                type="button"
                onClick={() => void scan(text, true)}
                disabled={busy}
                className="underline disabled:opacity-50"
              >
                Refresh
              </button>
            </p>
          )}
          <p className="text-lg font-black">
            {usd(exact)} found on-chain
            {(res.totalEstUsd ?? 0) > exact && (
              <span className="text-sm font-normal text-violet-300">
                {" "}
                + {usd((res.totalEstUsd ?? 0) - exact)} estimated upside (yields, savings: not money
                sitting there)
              </span>
            )}
          </p>
          {(res.atRiskUsd ?? 0) > 0 && (
            <p className="text-sm text-amber-200">
              {usd(res.atRiskUsd)} exposed to risky approvals or tokens
            </p>
          )}
          <ol className="mt-3 space-y-2">
            {items.slice(0, 50).map((i, n) => (
              <li
                key={`${i.title}-${n}`}
                className="rounded-xl border border-violet-700 p-3 text-sm"
              >
                <div className="font-bold">
                  {i.estUsd != null && <span className="text-amber-300">{usd(i.estUsd)} </span>}
                  {i.title}
                  {i.estimateKind && i.estimateKind !== "exact" && (
                    <span className="ml-1 text-xs text-violet-300">({i.estimateKind})</span>
                  )}
                </div>
                {(i.walletLabel || i.wallet) && (
                  <div className="text-xs text-violet-300">{i.walletLabel ?? i.wallet}</div>
                )}
                {i.detail && <div className="text-violet-200">{i.detail}</div>}
                <div className="mt-1 flex flex-wrap gap-2">
                  {(i.steps ?? []).map((s) =>
                    s.url ? (
                      <a
                        key={s.step}
                        href={s.url}
                        target={s.url.startsWith("https://swapchan.com") ? undefined : "_blank"}
                        rel="noreferrer"
                        className="rounded-lg bg-violet-800 px-2 py-1 text-xs font-bold hover:bg-violet-700"
                      >
                        {s.step}. {s.label}
                      </a>
                    ) : null,
                  )}
                </div>
                {(i.steps ?? [])
                  .filter((s) => s.call)
                  .map((s) => (
                    <TxCallBox key={`call-${s.step}`} call={s.call as TxCall} />
                  ))}
              </li>
            ))}
          </ol>
          {(res.owedNotClaimableNow ?? []).length > 0 && (
            <div className="mt-4" data-testid="owed-not-claimable">
              <p className="font-bold">Owed to you but not claimable now (not counted above)</p>
              <ul className="mt-1 space-y-1 text-sm text-violet-200">
                {(res.owedNotClaimableNow ?? []).map((l, n) => (
                  <li key={`${l.protocol}-${n}`}>
                    <span className="font-bold">{l.protocol}</span>
                    {l.owed ? `: ${l.owed}` : ""}. {l.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {items.length === 0 && res.status !== "running" && (
            <p>
              {(res.owedNotClaimableNow ?? []).length
                ? "Nothing claimable right now."
                : "Nothing found on these wallets."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
