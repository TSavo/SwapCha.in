"use client";

import { CrossmintEmbeddedCheckout, CrossmintProvider } from "@crossmint/client-sdk-react-ui";
import { useState } from "react";
import { API_URL } from "@/lib/api";

const CLIENT_KEY = process.env.NEXT_PUBLIC_CROSSMINT_CLIENT_KEY ?? "";

/**
 * Card on-ramp (Crossmint). Collects an email + amount, asks our server to create the order (the
 * server key never leaves the backend), then mounts Crossmint's embedded checkout — which handles the
 * card + KYC and delivers USDC to the connected wallet. SwapChan never touches the card data or funds.
 */
export default function FundWithCard({
  chainId,
  walletAddress,
  suggestedUsd,
  onClose,
}: {
  chainId: number;
  walletAddress: string;
  suggestedUsd?: string | undefined;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState(suggestedUsd ?? "50");
  const [order, setOrder] = useState<{ orderId: string; clientSecret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API_URL}/onramp/order`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress, chainId, amountUsd: amount, email }),
      });
      const j = (await r.json()) as { orderId?: string; clientSecret?: string; error?: string };
      if (!r.ok || !j.orderId || !j.clientSecret)
        throw new Error(j.error ?? "could not start checkout");
      setOrder({ orderId: j.orderId, clientSecret: j.clientSecret });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not start checkout");
    } finally {
      setBusy(false);
    }
  };

  if (!CLIENT_KEY)
    return <div className="text-xs text-red-300">Card on-ramp isn’t configured.</div>;

  if (order) {
    return (
      <div className="space-y-2">
        <CrossmintProvider apiKey={CLIENT_KEY}>
          <CrossmintEmbeddedCheckout
            orderId={order.orderId}
            clientSecret={order.clientSecret}
            payment={{
              receiptEmail: email,
              crypto: { enabled: false },
              fiat: { enabled: true },
              defaultMethod: "fiat",
            }}
          />
        </CrossmintProvider>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-white/15 px-3 py-1.5 text-sm text-violet-100"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-violet-200">
        Buy USDC with a card — it arrives in your wallet ({walletAddress.slice(0, 6)}…
        {walletAddress.slice(-4)}).
      </div>
      <input
        type="email"
        placeholder="email for the receipt"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg bg-white/10 px-2 py-1 text-sm text-violet-50 placeholder:text-violet-300/40"
      />
      <div className="flex items-center gap-2">
        <span className="text-sm text-violet-200">$</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-24 rounded-lg bg-white/10 px-2 py-1 text-sm text-violet-50"
        />
        <button
          type="button"
          disabled={busy || !email || !(Number(amount) > 0)}
          onClick={() => void start()}
          className="rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Starting…" : "Continue"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-white/15 px-3 py-1.5 text-sm text-violet-100"
        >
          Cancel
        </button>
      </div>
      {err && <div className="text-xs text-red-300">{err}</div>}
    </div>
  );
}
