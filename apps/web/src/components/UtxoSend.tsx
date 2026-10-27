"use client";

import type { Quote, QuoteRequest, UtxoDeposit, UtxoTrack } from "@swapchan/shared";
import { useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { api } from "../lib/api";
import { CopyButton, FullAddress } from "./FullAddress";

type Props = {
  request: QuoteRequest | null | undefined;
  quote: Quote | null | undefined;
  recipient: string;
  recipientInvalid: boolean;
  chainName: string;
  toChainName: string;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** LTC/DOGE/BCH origin: THORChain only. Deposit address (any wallet) or an unsigned PSBT. */
export function UtxoSend({
  request,
  quote,
  recipient,
  recipientInvalid,
  chainName,
  toChainName,
}: Props) {
  const [tab, setTab] = useState<"deposit" | "psbt">("deposit");
  const [refund, setRefund] = useState("");
  const [deposit, setDeposit] = useState<UtxoDeposit | null>(null);
  const [psbt, setPsbt] = useState<{ psbt: string; text: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const thor = quote?.provider === "thorchain";
  const ready = !!request && thor && !recipientInvalid && !!recipient;

  useEffect(() => {
    setDeposit(null);
    setPsbt(null);
    setErr("");
  }, [request, quote]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3" data-testid="utxo-send">
      <p className="text-sm">
        {chainName} swaps go through THORChain only. Your coins go to a THORChain vault with a memo
        naming your {toChainName} address.
      </p>
      <div className="flex gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "deposit"}
          onClick={() => setTab("deposit")}
        >
          Send from any wallet
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "psbt"}
          onClick={() => setTab("psbt")}
        >
          Unsigned transaction (PSBT)
        </button>
      </div>
      {!thor && <p className="text-sm">Waiting for a THORChain quote.</p>}
      <label className="block text-sm">
        {tab === "deposit"
          ? `Your ${chainName} refund address`
          : `Your ${chainName} sending address`}
        <input
          className="mt-1 w-full font-mono"
          value={refund}
          onChange={(e) => setRefund(e.target.value.trim())}
          data-testid="utxo-refund"
        />
      </label>
      {tab === "deposit" ? (
        <button
          type="button"
          disabled={!ready || !refund || busy}
          data-testid="utxo-deposit-btn"
          onClick={() => run(async () => setDeposit(await api.utxoDeposit(request!, refund)))}
        >
          Show deposit details
        </button>
      ) : (
        <button
          type="button"
          disabled={!ready || !refund || busy}
          data-testid="utxo-psbt-btn"
          onClick={() =>
            run(async () => {
              const b = await api.build(quote!, refund, false);
              const d = b.nonEvmTx?.data as
                | { psbt?: string; summary?: { text?: string } }
                | undefined;
              if (!d?.psbt) throw new Error("No PSBT was returned");
              setPsbt({ psbt: d.psbt, text: d.summary?.text ?? "" });
            })
          }
        >
          Build unsigned PSBT
        </button>
      )}
      {err && (
        <p role="alert" className="text-sm">
          {err}
        </p>
      )}
      {tab === "deposit" && deposit && <DepositView d={deposit} />}
      {tab === "psbt" && psbt && (
        <div className="space-y-2 text-sm" data-testid="utxo-psbt">
          <p>{psbt.text}</p>
          <p>Sign and broadcast it in your own wallet. Check the memo and vault before signing.</p>
          <textarea readOnly className="w-full font-mono" rows={4} value={psbt.psbt} />
          <CopyButton value={psbt.psbt} />
        </div>
      )}
      <Tracker />
    </div>
  );
}

function DepositView({ d }: { d: UtxoDeposit }) {
  // QR drawn locally; carries the vault address only (wallets cannot add the memo from a QR)
  const svg = useMemo(() => renderSVG(d.vault, { border: 2 }), [d.vault]);
  return (
    <div className="space-y-2 text-sm" data-testid="utxo-deposit">
      <div
        className="h-40 w-40"
        aria-label="QR code of the vault address"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p>
        Vault: <FullAddress address={d.vault} testId="utxo-vault" />
      </p>
      <p>
        Exact amount: <span className="font-mono">{d.amountDisplay}</span>{" "}
        <CopyButton value={d.amountDisplay} />
      </p>
      <p>
        Memo (required, {d.memoBytes}/{d.memoLimit} bytes):{" "}
        <span className="break-all font-mono">{d.memo}</span> <CopyButton value={d.memo} />
      </p>
      <p>Minimum: {d.minimumDisplay}</p>
      <p>Expires: {new Date(d.expiresAt * 1000).toLocaleString()}</p>
      <p>
        Refund address: <FullAddress address={d.refund} />
      </p>
      <ul className="list-disc pl-5">
        {d.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function Tracker() {
  const [txid, setTxid] = useState("");
  const [st, setSt] = useState<UtxoTrack | null>(null);
  const [err, setErr] = useState("");
  const valid = /^(0x)?[0-9a-fA-F]{64}$/.test(txid);
  useEffect(() => {
    if (!valid) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.utxoStatus(txid);
        if (stop) return;
        setSt(s);
        setErr("");
        if (["paid_out", "refunded", "failed"].includes(s.state)) return;
      } catch (e) {
        if (!stop) setErr(errText(e));
      }
      if (!stop) timer = setTimeout(tick, 15000);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [txid, valid]);
  return (
    <div className="space-y-1 text-sm" data-testid="utxo-track">
      <label className="block">
        Track a sent transaction (txid)
        <input
          className="mt-1 w-full font-mono"
          value={txid}
          onChange={(e) => setTxid(e.target.value.trim())}
        />
      </label>
      {err && <p role="alert">{err}</p>}
      {st && (
        <p>
          {st.message}{" "}
          <a href={st.thorchainUrl} target="_blank" rel="noreferrer">
            THORChain
          </a>
          {st.payout?.url && (
            <>
              {" · "}
              <a href={st.payout.url} target="_blank" rel="noreferrer">
                payout tx
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
