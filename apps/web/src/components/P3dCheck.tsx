"use client";

import Link from "next/link";
import { useState } from "react";
import { API_URL } from "@/lib/api";

type Step = { step: number; kind: string; label: string; url?: string | null };
type Found = {
  protocol: string;
  what: string;
  valueUsd: number | null;
  risk?: string;
  steps?: Step[];
};

const usd = (n: number | null | undefined) =>
  n == null ? "?" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Fast PoWH3D check (GET /onchain/money/legacy): dividends + tokens, unsigned withdraw/exit, swap, then the full scan. */
export function P3dCheck() {
  const [addr, setAddr] = useState("");
  const [res, setRes] = useState<{ address: string; items: Found[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function check() {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch(
        `${API_URL}/onchain/money/legacy?address=${encodeURIComponent(addr.trim())}`,
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setRes(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const p3d = res?.items.filter((i) => i.protocol.startsWith("PoWH3D")) ?? [];
  const other = res?.items.filter((i) => !i.protocol.startsWith("PoWH3D")) ?? [];
  const total = p3d.reduce((s, i) => s + (i.valueUsd ?? 0), 0);
  const full = res ? `/find-money?address=${res.address}` : "/find-money";
  return (
    <section
      data-testid="p3d-check"
      className="rounded-2xl border-2 border-violet-700 bg-violet-950 p-4"
    >
      <label htmlFor="p3d-in" className="mb-1 block font-bold">
        Ethereum address
      </label>
      <div className="flex gap-2">
        <input
          id="p3d-in"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x…"
          className="flex-1 rounded-xl border-2 border-violet-700 bg-violet-900 p-2 font-mono text-sm"
        />
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(addr.trim())}
          className="rounded-xl bg-amber-300 px-4 py-2 font-black text-violet-950 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check P3D"}
        </button>
      </div>
      {err && <p className="mt-2 text-red-300">{err}</p>}
      {res && (
        <div className="mt-4" data-testid="p3d-result">
          {p3d.length === 0 ? (
            <p>No PoWH3D dividends or tokens on this address.</p>
          ) : (
            <p className="text-lg font-black">We found {usd(total)} in P3D.</p>
          )}
          {[...p3d, ...other].map((i) => (
            <div key={i.protocol} className="mt-2 rounded-xl border border-violet-700 p-3 text-sm">
              <div className="font-bold">
                <span className="text-amber-300">{usd(i.valueUsd)}</span> {i.protocol}: {i.what}
              </div>
              {i.risk && <div className="text-xs text-violet-300">{i.risk}</div>}
              <div className="mt-1 flex flex-wrap gap-2">
                {(i.steps ?? []).map((s) =>
                  s.url ? (
                    <a
                      key={s.step}
                      href={s.url}
                      className="rounded-lg bg-violet-800 px-2 py-1 text-xs font-bold hover:bg-violet-700"
                    >
                      {s.step}. {s.label}
                    </a>
                  ) : null,
                )}
              </div>
            </div>
          ))}
          <Link
            href={full}
            className="mt-3 inline-block rounded-xl bg-amber-300 px-4 py-2 font-black text-violet-950"
          >
            {p3d.length ? "Now scan everything else →" : "Scan everything else on this wallet →"}
          </Link>
        </div>
      )}
    </section>
  );
}
