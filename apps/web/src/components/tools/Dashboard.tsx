"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { SpeechBubble } from "@/components/Character";
import { ConnectButton } from "@/components/ConnectButton";
import { API_URL } from "@/lib/api";
import { useSolana } from "@/lib/useSolana";
import { DataView } from "./DataView";

type J = Record<string, unknown> & { error?: string; next?: { label: string; swapUrl: string } };
const get = async (path: string): Promise<J> => {
  const r = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(90_000) });
  const j = (await r.json().catch(() => ({}))) as J;
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
};
const usd = (n: unknown) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
    : "–";
const card = "rounded-2xl border-2 border-violet-600 bg-violet-950/80 p-4";

function Section({
  title,
  q,
  children,
}: {
  title: string;
  q: { isLoading: boolean; error: Error | null; data?: J | undefined };
  children: (d: J) => React.ReactNode;
}) {
  return (
    <section className={card}>
      <h2 className="mb-3 text-xl font-black">{title}</h2>
      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-violet-300">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />{" "}
          Checking on-chain…
        </div>
      ) : q.error ? (
        <p className="text-sm text-rose-300">Couldn't load: {q.error.message}</p>
      ) : q.data ? (
        children(q.data)
      ) : null}
    </section>
  );
}

interface Holding {
  chainId: number;
  chain: string;
  address: string;
  symbol: string;
  balance: string;
  valueUsd: number | null;
  risk?: { level?: string } | string;
}
interface Item {
  rank: number;
  category: string;
  title: string;
  estUsd: number | null;
  estimateKind: string;
  detail?: string;
  action?: string;
  swapUrl: string;
  shortUrl?: string;
  protocolUrl?: string;
  steps?: {
    step: number;
    kind: "recover" | "swap";
    label: string;
    url: string;
    shortUrl?: string;
  }[];
  revokeTx?: { chainId: number; to: `0x${string}`; data: `0x${string}` };
}

function Revoke({ tx }: { tx: NonNullable<Item["revokeTx"]> }) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [st, setSt] = useState<string>();
  if (!address) return null;
  return (
    <button
      type="button"
      className="rounded-lg border-2 border-rose-300 bg-rose-500 px-3 py-1 text-xs font-black text-white hover:bg-rose-400"
      onClick={async () => {
        try {
          if (chainId !== tx.chainId) await switchChainAsync({ chainId: tx.chainId });
          setSt("Confirm in wallet…");
          const h = await sendTransactionAsync({ to: tx.to, data: tx.data, chainId: tx.chainId });
          setSt(`Sent ${h.slice(0, 10)}…`);
        } catch (e) {
          setSt(e instanceof Error ? e.message.split("\n")[0] : "Failed");
        }
      }}
    >
      {st ?? "Revoke"}
    </button>
  );
}

function sellUrl(h: Holding) {
  const p = new URLSearchParams({
    fromChain: String(h.chainId),
    toChain: String(h.chainId),
    fromToken: h.address,
    amount: h.balance,
  });
  return `/?${p}`;
}

export function DashboardView({ address: input }: { address: string }) {
  const name = useQuery({
    queryKey: ["name", input],
    queryFn: () => get(`/onchain/name?q=${encodeURIComponent(input)}`),
    staleTime: 3_600_000,
  });
  const raw = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{25,44}|T[1-9A-HJ-NP-Za-km-z]{33})$/.test(
    input,
  )
    ? input
    : undefined;
  const addr = (name.data?.address as string | undefined) ?? raw;
  const en = !!addr;
  const opt = { enabled: en, staleTime: 120_000, retry: 1 } as const;
  const bal = useQuery({
    queryKey: ["bal", addr],
    queryFn: () => get(`/onchain/balances?address=${addr}`),
    ...opt,
  });
  const money = useQuery({
    queryKey: ["money", addr],
    queryFn: () => get(`/onchain/money?address=${addr}`),
    ...opt,
  });
  const drops = useQuery({
    queryKey: ["drops", addr],
    queryFn: () => get(`/onchain/airdrops?address=${addr}`),
    ...opt,
  });
  const pnl = useQuery({
    queryKey: ["pnl", addr],
    queryFn: () => get(`/onchain/pnl?address=${addr}`),
    ...opt,
  });
  const hist = useQuery({
    queryKey: ["hist", addr],
    queryFn: () => get(`/onchain/history?address=${addr}`),
    ...opt,
  });
  const items = (money.data?.items as Item[] | undefined) ?? [];
  const riskBy = new Map<string, string>();
  for (const i of items)
    if (i.category.startsWith("Risky token")) {
      const t = new URL(i.swapUrl).searchParams.get("fromToken");
      if (t) riskBy.set(t.toLowerCase(), "high");
    }
  if (name.isLoading && !raw) return <p className={card}>Resolving {input}…</p>;
  if (!addr)
    return (
      <p className={`${card} text-rose-300`}>
        Couldn't resolve “{input}”. Paste a 0x, Solana or Tron address, an ENS (.eth) or SNS (.sol)
        name.
      </p>
    );
  return (
    <div className="flex w-full flex-col gap-4" data-testid="dashboard">
      <p className="font-mono text-xs break-all text-violet-300">
        {input !== addr ? `${input} → ` : ""}
        {addr}
      </p>
      <Section title="💰 Money we found" q={money}>
        {(d) => (
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-emerald-900/60 p-3">
                <p className="text-xs text-emerald-200">Claimable / recoverable / yield</p>
                <p className="text-2xl font-black">{usd(d.totalEstUsd)}</p>
              </div>
              <div className="rounded-xl bg-rose-900/60 p-3">
                <p className="text-xs text-rose-200">At risk (protect it)</p>
                <p className="text-2xl font-black">{usd(d.atRiskUsd)}</p>
              </div>
              <div className="rounded-xl bg-violet-900 p-3">
                <p className="text-xs text-violet-200">Opportunities</p>
                <p className="text-2xl font-black">{String(d.opportunities ?? items.length)}</p>
              </div>
            </div>
            <p className="text-xs text-violet-300">{String(d.totals ?? "")}</p>
            <SpeechBubble who="swapchan">
              {items.length
                ? "SwapChan is here to help you find your money, senpai! Step 1 gets it back to your wallet, step 2 swaps it to USDC. I never sign or hold anything: your wallet signs every step."
                : "I looked everywhere I know, senpai. Nothing stuck here right now!"}
            </SpeechBubble>
            {(() => {
              const all = d.swapAll as { url: string; shortUrl?: string } | undefined;
              return all ? (
                <a
                  href={all.shortUrl ?? all.url}
                  data-testid="swap-all"
                  className="self-start rounded-full bg-amber-300 px-5 py-2 font-black text-violet-950"
                >
                  Swap all of it to USDC →
                </a>
              ) : null;
            })()}
            <ol className="flex flex-col gap-2">
              {items.map((i) => (
                <li
                  key={`${i.rank}-${i.title}`}
                  className="flex flex-col gap-2 rounded-xl border border-violet-700 bg-violet-950 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-violet-300">
                      #{i.rank} · {i.category} · {i.estimateKind}
                    </p>
                    <p className="font-bold">{i.title}</p>
                    {i.detail && <p className="text-xs text-violet-300">{i.detail}</p>}
                    {i.action && <p className="text-xs text-amber-200">{i.action}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {typeof i.estUsd === "number" && (
                      <span className="font-black text-emerald-300">{usd(i.estUsd)}</span>
                    )}
                    {i.revokeTx && <Revoke tx={i.revokeTx} />}
                    {i.protocolUrl && (
                      <a
                        href={i.protocolUrl}
                        target="_blank"
                        rel="noopener nofollow"
                        className="rounded-lg border-2 border-violet-400 px-3 py-1 text-xs font-bold"
                      >
                        Open protocol
                      </a>
                    )}
                    {i.steps?.length ? (
                      i.steps.map((st) => (
                        <a
                          key={st.step}
                          href={st.shortUrl ?? st.url}
                          data-testid={`step-${st.kind}`}
                          className={
                            st.kind === "recover"
                              ? "rounded-lg border-2 border-emerald-400 px-3 py-1 text-xs font-black text-emerald-200"
                              : "rounded-lg border-2 border-violet-950 bg-amber-400 px-3 py-1 text-xs font-black text-violet-950 hover:bg-amber-300"
                          }
                        >
                          {st.step}. {st.kind === "recover" ? "Get it back" : "Swap to USDC"} →
                        </a>
                      ))
                    ) : (
                      <a
                        href={i.swapUrl}
                        className="rounded-lg border-2 border-violet-950 bg-amber-400 px-3 py-1 text-xs font-black text-violet-950 hover:bg-amber-300"
                      >
                        Swap →
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {Array.isArray(d.notChecked) && (
              <p className="text-xs text-violet-400">
                Not checked: {(d.notChecked as string[]).join(" · ")}
              </p>
            )}
          </div>
        )}
      </Section>
      <Section title="👛 Balances" q={bal}>
        {(d) => {
          const hs = ((d.holdings as Holding[] | undefined) ?? []).slice(0, 60);
          return (
            <div className="flex flex-col gap-2">
              <p className="text-3xl font-black">{usd(d.totalUsd)}</p>
              <div className="overflow-x-auto rounded-xl border-2 border-violet-700">
                <table className="w-full text-left text-sm">
                  <thead className="bg-violet-900 text-violet-200">
                    <tr>
                      <th className="px-3 py-2">Token</th>
                      <th className="px-3 py-2">Chain</th>
                      <th className="px-3 py-2">Balance</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {hs.map((h) => {
                      const r =
                        typeof h.risk === "string"
                          ? h.risk
                          : (h.risk?.level ?? riskBy.get(h.address.toLowerCase()));
                      return (
                        <tr
                          key={`${h.chainId}-${h.address}`}
                          className="border-t border-violet-800"
                        >
                          <td className="px-3 py-2 font-bold">
                            {h.symbol}{" "}
                            {r && r !== "low" && (
                              <span
                                className={`ml-1 rounded px-1.5 text-[10px] font-black ${r === "high" ? "bg-rose-500" : "bg-amber-500 text-violet-950"}`}
                              >
                                {r} risk
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">{h.chain}</td>
                          <td className="px-3 py-2">
                            {Number(h.balance).toLocaleString("en-US", {
                              maximumFractionDigits: 6,
                            })}
                          </td>
                          <td className="px-3 py-2">{usd(h.valueUsd)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <a
                              href={sellUrl(h)}
                              className="mr-1 rounded-lg bg-amber-400 px-2 py-1 text-xs font-black text-violet-950"
                            >
                              Sell
                            </a>
                            <a
                              href={`/?toChain=${h.chainId}&toToken=${h.address}&fromChain=${h.chainId}`}
                              className="rounded-lg border-2 border-amber-300 px-2 py-0.5 text-xs font-bold"
                            >
                              Swap
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-violet-400">{String(d.coverage ?? "")}</p>
            </div>
          );
        }}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="🪂 Airdrops & unclaimed" q={drops}>
          {(d) => <DataView data={d} />}
        </Section>
        <Section title="📊 PnL" q={pnl}>
          {(d) => <DataView data={d} />}
        </Section>
      </div>
      <Section title="📜 Recent activity" q={hist}>
        {(d) => <DataView data={d} />}
      </Section>
    </div>
  );
}

export function DashboardHome() {
  const { address } = useAccount();
  const sol = useSolana();
  const router = useRouter();
  const [v, setV] = useState("");
  const mine = address ?? sol.address;
  return (
    <div className="flex w-full flex-col gap-4">
      <form
        className="flex w-full flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) router.push(`/dashboard/${encodeURIComponent(v.trim())}`);
        }}
      >
        <input
          aria-label="Wallet address or name"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Paste any wallet: 0x…, vitalik.eth, toly.sol, T…"
          className="min-w-0 flex-1 rounded-xl border-2 border-violet-400 bg-violet-950 px-4 py-3 font-mono text-sm placeholder:text-violet-400 focus:border-amber-300 focus:ring-4 focus:ring-amber-300/40 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-xl border-2 border-violet-950 bg-amber-400 px-6 py-3 font-black text-violet-950 shadow-[0_3px_0_#2e1065] hover:bg-amber-300"
        >
          Find money
        </button>
      </form>
      {mine ? (
        <DashboardView address={mine} />
      ) : (
        <div className={`${card} flex flex-col items-center gap-3 text-center`}>
          <p className="text-lg font-bold">
            Connect a wallet to see your balances, PnL, approvals and money you forgot about.
          </p>
          <div className="w-full max-w-xs">
            <ConnectButton />
          </div>
          <p className="text-sm text-violet-300">
            Or try{" "}
            <Link href="/dashboard/vitalik.eth" className="font-bold text-amber-300 underline">
              vitalik.eth
            </Link>{" "}
            ·{" "}
            <Link href="/dashboard/toly.sol" className="font-bold text-amber-300 underline">
              toly.sol
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
