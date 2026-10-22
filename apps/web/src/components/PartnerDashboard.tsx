"use client";

import { SUPPORTED_CHAINS } from "@swapchan/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { scriptSnippet } from "@/lib/embed";

interface Swap {
  txHash: string;
  provider: string;
  fromChainId: number;
  toChainId: number;
  volumeUsd: number | null;
  ourFeeUsd: number;
  counted: number;
  reason: string | null;
  partnerUsd: number;
  createdAt: number;
}
interface Dash {
  partner: {
    id: string;
    name: string;
    siteUrl: string;
    evmAddress: string;
    solanaAddress: string | null;
    shareBps: number;
  };
  quotes: number;
  swaps: number;
  countedSwaps: number;
  volumeUsd: number;
  feesUsd: number;
  earnedUsd: number;
  paidUsd: number;
  owedUsd: number;
  recent: Swap[];
  payouts: { amountUsd: number; txHash: string | null; createdAt: number }[];
}

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`;
const chain = (id: number) => SUPPORTED_CHAINS[id as keyof typeof SUPPORTED_CHAINS]?.name ?? id;

export function PartnerDashboard({ id }: { id: string }) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(new URLSearchParams(window.location.search).get("t") ?? ""), []);
  const q = useQuery({
    queryKey: ["partner", id, token],
    enabled: token !== null,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Dash> => {
      const res = await fetch(
        `${API_URL}/partners/${encodeURIComponent(id)}?t=${encodeURIComponent(token ?? "")}`,
      );
      if (!res.ok)
        throw new Error(
          "Unknown partner or wrong link. Use the private link you got when you registered.",
        );
      return res.json() as Promise<Dash>;
    },
  });
  if (q.isError) return <p className="mt-10 text-rose-300">{(q.error as Error).message}</p>;
  if (!q.data) return <p className="mt-10 text-violet-300">Loading…</p>;
  const d = q.data;
  const stat = (label: string, v: string, hi = false) => (
    <div
      className={`rounded-2xl border-2 p-3 ${hi ? "border-amber-400" : "border-violet-700"} bg-violet-950`}
    >
      <div className="text-xs text-violet-300">{label}</div>
      <div className={`text-2xl font-black ${hi ? "text-amber-300" : ""}`}>{v}</div>
    </div>
  );
  return (
    <div className="w-full max-w-4xl">
      <h1 className="mt-2 text-3xl font-black">{d.partner.name}</h1>
      <p className="text-sm text-violet-300">
        Partner id <code>{d.partner.id}</code> · {d.partner.shareBps / 100}% of SwapChan's fee ·
        payouts to <code className="break-all">{d.partner.evmAddress}</code>
        {d.partner.solanaAddress && (
          <>
            {" "}
            / <code className="break-all">{d.partner.solanaAddress}</code>
          </>
        )}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat("Owed to you", usd(d.owedUsd), true)}
        {stat("Earned (all time)", usd(d.earnedUsd))}
        {stat("Paid out", usd(d.paidUsd))}
        {stat("Swap volume", usd(d.volumeUsd))}
        {stat("Quotes shown", String(d.quotes))}
        {stat("Swaps", String(d.swaps))}
        {stat("Swaps that earned", String(d.countedSwaps))}
        {stat("SwapChan fees on them", usd(d.feesUsd))}
      </div>
      <h2 className="mt-8 mb-2 text-xl font-black">Recent swaps</h2>
      {d.recent.length === 0 ? (
        <p className="text-sm text-violet-300">No swaps yet. Embed your widget to start earning:</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-violet-300">
              <tr>
                <th className="pr-3">When</th>
                <th className="pr-3">Route</th>
                <th className="pr-3">Provider</th>
                <th className="pr-3">Volume</th>
                <th className="pr-3">Your share</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((s) => (
                <tr key={s.txHash} className="border-t border-violet-800">
                  <td className="pr-3">{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="pr-3">
                    {chain(s.fromChainId)} → {chain(s.toChainId)}
                  </td>
                  <td className="pr-3">{s.provider}</td>
                  <td className="pr-3">{s.volumeUsd === null ? "-" : usd(s.volumeUsd)}</td>
                  <td className="pr-3">
                    {s.counted ? (
                      usd(s.partnerUsd)
                    ) : (
                      <span className="text-violet-400">{s.reason}</span>
                    )}
                  </td>
                  <td className="font-mono text-xs">{s.txHash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/50 p-3 text-xs">
        {scriptSnippet({ partner: d.partner.id })}
      </pre>
      <Link
        href={`/widget?partner=${d.partner.id}`}
        className="mt-2 inline-block text-amber-300 underline"
      >
        Customize your widget
      </Link>
      <p className="mt-6 text-xs text-violet-400">
        Keep this link private. Payouts are sent periodically once your balance is worth the gas.
      </p>
    </div>
  );
}
