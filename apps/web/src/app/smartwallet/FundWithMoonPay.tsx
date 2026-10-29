"use client";

import { loadMoonPay } from "@moonpay/moonpay-js";
import { useState } from "react";
import { API_URL } from "@/lib/api";

const PK = process.env.NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY ?? "";
const ENVIRONMENT = PK.startsWith("pk_test_") ? "sandbox" : "production";

/** SwapChan chainId -> MoonPay currencyCode for USDC on that chain (matches the server's MOONPAY_USDC). */
const CURRENCY: Record<number, string> = {
  1: "usdc",
  8453: "usdc_base",
  42161: "usdc_arbitrum",
  10: "usdc_optimism",
  137: "usdc_polygon",
  792703809: "usdc_sol",
};

/**
 * Card on-ramp (MoonPay). Uses MoonPay's Web SDK to build the widget URL in-browser, asks our server
 * to HMAC-sign exactly that URL's query string (the secret key never leaves the backend), then shows
 * MoonPay's overlay — which takes the card + KYC and delivers USDC straight to the connected wallet.
 * SwapChan never touches the card data or the funds. We sign through the SDK (not a hand-built URL)
 * because MoonPay validates the signature in the SDK's embedded context, so only generateUrlForSigning()'s
 * exact canonical query (mpSdk param and all) will validate.
 */
export default function FundWithMoonPay({
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
  const [amount, setAmount] = useState(suggestedUsd ?? "50");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const currencyCode = CURRENCY[chainId];
      if (!currencyCode) throw new Error(`card on-ramp isn’t supported on chain ${chainId}`);
      const moonPay = await loadMoonPay();
      if (!moonPay) throw new Error("couldn’t load MoonPay");
      const widget = moonPay({
        flow: "buy",
        environment: ENVIRONMENT,
        variant: "overlay",
        params: {
          apiKey: PK,
          currencyCode,
          walletAddress,
          baseCurrencyCode: "usd",
          baseCurrencyAmount: amount,
        },
      });
      if (!widget) throw new Error("couldn’t start MoonPay");
      // The SDK builds the exact URL MoonPay will validate; our server signs its query string.
      const urlForSignature = widget.generateUrlForSigning();
      const r = await fetch(`${API_URL}/onramp/moonpay/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: urlForSignature }),
      });
      const j = (await r.json()) as { signature?: string; error?: string };
      if (!r.ok || !j.signature) throw new Error(j.error ?? "couldn’t sign the on-ramp URL");
      widget.updateSignature(j.signature);
      widget.show();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "couldn’t start the card on-ramp");
    } finally {
      setBusy(false);
    }
  };

  if (!PK) return <div className="text-xs text-red-300">Card on-ramp isn’t configured.</div>;

  return (
    <div className="space-y-2">
      <div className="text-xs text-violet-200">
        Buy USDC with a card — it arrives in your wallet ({walletAddress.slice(0, 6)}…
        {walletAddress.slice(-4)}).
      </div>
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
          disabled={busy || !walletAddress || !(Number(amount) > 0)}
          onClick={() => void start()}
          className="rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Opening…" : "Buy with card"}
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
