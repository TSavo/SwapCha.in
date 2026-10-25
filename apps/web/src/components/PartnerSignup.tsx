"use client";

import Link from "next/link";
import { useState } from "react";
import { API_URL } from "@/lib/api";
import { affiliateLink, scriptSnippet } from "@/lib/embed";

const field =
  "mt-1 w-full rounded-lg border-2 border-violet-700 bg-violet-900 px-3 py-2 text-sm outline-none focus:border-amber-400";

interface Done {
  id: string;
  token: string;
}

export function PartnerSignup() {
  const [f, setF] = useState({ name: "", siteUrl: "", evmAddress: "", solanaAddress: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`${API_URL}/partners`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, solanaAddress: f.solanaAddress || undefined }),
      });
      const body = (await res.json().catch(() => null)) as
        | (Done & { error?: string; issues?: { path: string[]; message: string }[] })
        | null;
      if (!res.ok || !body?.id)
        throw new Error(
          body?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ??
            body?.error ??
            `HTTP ${res.status}`,
        );
      setDone({ id: body.id, token: body.token });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    // Token in the fragment: never sent to servers or leaked via Referer/analytics.
    const dash = `/partners/${done.id}#t=${done.token}`;
    return (
      <div
        className="mt-6 space-y-3 rounded-2xl border-2 border-amber-400 bg-violet-950 p-4"
        data-testid="partner-done"
      >
        <p className="text-lg font-black">
          You're in! Partner id: <code className="text-amber-300">{done.id}</code>
        </p>
        <p className="text-sm text-violet-200">
          Bookmark your private dashboard link. It's the only way in, and anyone with it can see
          your stats:
        </p>
        <Link
          href={dash}
          className="block break-all rounded-lg bg-black/50 p-2 font-mono text-xs text-amber-300 underline"
        >
          https://swapchan.com{dash}
        </Link>
        <p className="text-sm text-violet-200">Your affiliate link (works on any page):</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/50 p-2 text-xs">
          {affiliateLink(done.id)}
        </pre>
        <p className="text-sm text-violet-200">Your widget snippet:</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/50 p-2 text-xs">
          {scriptSnippet({ partner: done.id })}
        </pre>
        <Link
          href={`/widget?partner=${done.id}`}
          className="inline-block rounded-xl bg-amber-400 px-4 py-2 font-black text-violet-950"
        >
          Customize your widget →
        </Link>
      </div>
    );
  }
  const input = (k: keyof typeof f, label: string, ph: string, req = true) => (
    <label className="block text-sm font-bold">
      {label}
      <input
        className={field}
        required={req}
        placeholder={ph}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </label>
  );
  return (
    <form
      onSubmit={submit}
      className="mt-6 space-y-3 rounded-2xl border-2 border-violet-700 bg-violet-950 p-4"
    >
      {input("name", "Project or site name", "Moon Project")}
      {input("siteUrl", "Site URL", "https://example.com")}
      {input("evmAddress", "Payout address (EVM)", "0x…")}
      {input("solanaAddress", "Solana payout address (optional)", "base58 address", false)}
      {err && <p className="text-sm text-rose-300">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-fuchsia-500 py-3 font-black text-violet-950 disabled:opacity-40"
      >
        {busy ? "Registering…" : "Get my partner id"}
      </button>
      <p className="text-xs text-violet-300">
        Swaps from your own payout address don't earn a share. Only swaps where the provider
        confirmed SwapChan's fee count.
      </p>
    </form>
  );
}
