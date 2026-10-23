"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api";
import { DataView } from "./DataView";

type J = Record<string, unknown> & { error?: string; next?: { label: string; swapUrl: string } };
const input =
  "w-full rounded-xl border-2 border-violet-400 bg-violet-950 px-4 py-3 font-mono text-sm placeholder:text-violet-400 focus:border-amber-300 focus:ring-4 focus:ring-amber-300/40 focus:outline-none";
const btn =
  "rounded-xl border-2 border-violet-950 bg-amber-400 px-6 py-3 font-black text-violet-950 shadow-[0_3px_0_#2e1065] hover:bg-amber-300 disabled:opacity-60";

async function post(path: string, body: unknown): Promise<J> {
  const r = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  return (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as J;
}

function Result({ d }: { d: J | null }) {
  if (!d) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="tool-result">
      {d.error && (
        <p className="rounded-xl border-2 border-rose-400 bg-rose-950/60 px-4 py-3 text-sm">
          {String(d.error)}
        </p>
      )}
      {d.next && (
        <a
          href={d.next.swapUrl}
          className="block rounded-2xl border-2 border-violet-950 bg-amber-400 px-5 py-3 text-center text-lg font-black text-violet-950 hover:bg-amber-300"
        >
          {d.next.label} →
        </a>
      )}
      {!d.error && <DataView data={d} />}
    </div>
  );
}

const Field = ({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) => (
  <label htmlFor={id} className="flex flex-col gap-1 text-sm font-bold">
    {label}
    {children}
  </label>
);

export function SimulateForm() {
  const [f, setF] = useState({ chainId: "1", from: "", to: "", data: "", value: "0" });
  const [d, setD] = useState<J | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <div className="flex flex-col gap-4">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setD(await post("/onchain/simulate", { ...f, ...(f.data ? {} : { data: undefined }) }));
          setBusy(false);
        }}
      >
        <Field id="sim-chain" label="Chain">
          <select id="sim-chain" value={f.chainId} onChange={set("chainId")} className={input}>
            {[
              ["1", "Ethereum"],
              ["8453", "Base"],
              ["42161", "Arbitrum"],
              ["10", "Optimism"],
              ["137", "Polygon"],
              ["56", "BNB Chain"],
            ].map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field id="sim-from" label="From (signer)">
          <input
            id="sim-from"
            required
            value={f.from}
            onChange={set("from")}
            placeholder="0x… or name.eth"
            className={input}
          />
        </Field>
        <Field id="sim-to" label="To (contract)">
          <input
            id="sim-to"
            required
            value={f.to}
            onChange={set("to")}
            placeholder="0x…"
            className={input}
          />
        </Field>
        <Field id="sim-value" label="Value (wei)">
          <input id="sim-value" value={f.value} onChange={set("value")} className={input} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="sim-data" label="Calldata">
            <input
              id="sim-data"
              value={f.data}
              onChange={set("data")}
              placeholder="0x…"
              className={input}
            />
          </Field>
        </div>
        <button type="submit" disabled={busy} className={`${btn} sm:col-span-2`}>
          {busy ? "Simulating…" : "Simulate"}
        </button>
      </form>
      <Result d={d} />
    </div>
  );
}

export function RebalanceForm() {
  const [address, setAddress] = useState("");
  const [targets, setTargets] = useState("base ETH 50\nbase USDC 50");
  const [d, setD] = useState<J | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const t = targets
            .split("\n")
            .map((l) => l.trim().split(/\s+/))
            .filter((p) => p.length === 3)
            .map(([chainId, token, w]) => ({
              chainId: /^\d+$/.test(chainId ?? "") ? Number(chainId) : (chainId ?? ""),
              token: token ?? "",
              weight: Number(w),
            }));
          setBusy(true);
          setD(await post("/onchain/rebalance", { address, targets: t }));
          setBusy(false);
        }}
      >
        <Field id="rb-addr" label="Wallet">
          <input
            id="rb-addr"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… or name.eth"
            className={input}
          />
        </Field>
        <Field id="rb-t" label="Targets (one per line: chain token weight)">
          <textarea
            id="rb-t"
            rows={4}
            value={targets}
            onChange={(e) => setTargets(e.target.value)}
            className={input}
          />
        </Field>
        <button type="submit" disabled={busy} className={btn}>
          {busy ? "Pricing routes…" : "Build plan"}
        </button>
      </form>
      <Result d={d} />
    </div>
  );
}
