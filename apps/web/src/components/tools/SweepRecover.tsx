"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { SpeechBubble } from "@/components/Character";
import { ConnectButton } from "@/components/ConnectButton";
import { API_URL } from "@/lib/agents";
import { describeCall } from "@/lib/callSummary";
import { checkSweepTx, type SweepTx, txParams } from "@/lib/sweepCheck";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
type Built = {
  chainId: number;
  tx: SweepTx;
  addChain?: { chainId: string; chainName: string };
  verified?: { verified: boolean; reason?: string };
  note?: string;
};

/**
 * Fork coins (ETC/ETHW/EtherFair) and extra EVM chains (Fantom, Gnosis, ...): build the transfer back to the CONNECTED
 * wallet, add/switch the network in the wallet, and sign it there. Signable only when the API verifier and the local
 * check both pass (EIP-155 chainId, pays only the connected wallet). Nothing is signed or broadcast by SwapChan.
 */
function ChainSweep(p: {
  kind: "fork" | "evm";
  coin: string;
  token?: string;
  from: string;
  sym: string;
  title: string;
}) {
  const { address, connector } = useAccount();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [hash, setHash] = useState<string>();
  const [built, setBuilt] = useState<Built>();
  const same = !!address && address.toLowerCase() === p.from.toLowerCase();
  const go = async () => {
    if (!address || !connector) return;
    setBusy(true);
    setErr(undefined);
    try {
      const path = p.kind === "evm" ? "evm-sweep" : "fork-sweep";
      const q = new URLSearchParams({
        chain: p.coin,
        from: address,
        to: address,
        ...(p.token ? { token: p.token } : {}),
      });
      const r = await fetch(`${API_URL}/onchain/${path}?${q}`);
      const j = (await r.json()) as Built & { error?: string; message?: string };
      if (!r.ok) throw new Error(String(j.error ?? j.message ?? r.status));
      setBuilt(j);
      if (!j.verified?.verified)
        throw new Error(`not signable: ${j.verified?.reason ?? "not verified"}`);
      const bad = checkSweepTx(j.tx, address, j.chainId, p.token);
      if (bad) throw new Error(`not signable: ${bad}`);
      const prov = (await connector.getProvider()) as Eip1193;
      const want = `0x${j.chainId.toString(16)}`;
      try {
        await prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
      } catch (e) {
        if (!j.addChain) throw e;
        await prov.request({ method: "wallet_addEthereumChain", params: [j.addChain] });
        await prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
      }
      const now = String(await prov.request({ method: "eth_chainId" }));
      if (BigInt(now) !== BigInt(j.chainId))
        throw new Error(`your wallet is on chain ${BigInt(now)}, not ${j.chainId}`);
      setHash(
        String(await prov.request({ method: "eth_sendTransaction", params: [txParams(j.tx)] })),
      );
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="chain-sweep">
      <SpeechBubble who="swapchan">
        {hash
          ? `Sent! Your ${p.sym} is on its way back to your wallet.`
          : `Get it back: connect the wallet that holds this ${p.sym} and sign one transfer back to it.`}
      </SpeechBubble>
      <div className="rounded-2xl border-2 border-violet-600 bg-violet-950 p-4 text-sm">
        <p className="text-xs font-bold text-violet-300">Get it back · {p.sym}</p>
        <h1 className="text-xl font-black">{p.title}</h1>
        <p className="mt-2 font-mono text-xs break-all text-violet-300">wallet {p.from}</p>
        <p className="mt-2 text-violet-200">
          SwapChan adds the network to your wallet if needed and only lets you sign an EIP-155
          transaction (with its chainId, so it cannot be replayed on another chain) that pays your
          own address.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!address ? (
            <ConnectButton />
          ) : !same ? (
            <p className="font-bold text-rose-300">
              Connect the wallet {p.from} to get these coins back.
            </p>
          ) : (
            <button
              type="button"
              disabled={busy || !!hash}
              onClick={go}
              className="rounded-lg border-2 border-violet-950 bg-amber-400 px-4 py-2 font-black text-violet-950 disabled:opacity-50"
            >
              {hash ? "Signed ✓" : busy ? "Preparing…" : "Get it back"}
            </button>
          )}
        </div>
        {built?.tx && (
          <p className="mt-2 font-mono text-xs break-all text-violet-200" data-testid="sign-prompt">
            {(() => {
              // ERC-20 sweep calls the token contract; a native sweep is a plain transfer to your wallet.
              const c = describeCall(built.tx.to, built.tx.data ?? "0x");
              return c.selector
                ? `Signing ${c.fn ?? "unknown function"} [${c.selector}] on contract ${c.contract}`
                : `Signing a plain transfer to ${c.contract}`;
            })()}
          </p>
        )}
        {built?.note && !hash ? <p className="mt-2 text-xs text-violet-300">{built.note}</p> : null}
        {hash && <p className="mt-2 font-mono text-xs break-all">tx {hash}</p>}
        {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
      </div>
      <p className="text-xs text-violet-400">
        You sign in your own wallet; SwapChan never holds your keys or funds.
      </p>
    </div>
  );
}

/** Builds an UNSIGNED sweep via the API. Nothing is signed or broadcast here; no keys ever touch this page. */
export function SweepRecover(p: {
  kind: "utxo" | "fork" | "evm";
  coin: string;
  token?: string;
  from: string;
  sym: string;
  title: string;
}) {
  if (p.kind !== "utxo") return <ChainSweep {...p} kind={p.kind} />;
  return <UtxoSweep {...p} />;
}

function UtxoSweep(p: {
  kind: "utxo" | "fork" | "evm";
  coin: string;
  token?: string;
  from: string;
  sym: string;
  title: string;
}) {
  const [to, setTo] = useState(p.kind !== "utxo" ? p.from : "");
  const [res, setRes] = useState<Record<string, unknown>>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const build = async () => {
    setBusy(true);
    setErr(undefined);
    setRes(undefined);
    const q =
      p.kind === "utxo"
        ? `utxo-sweep?${new URLSearchParams({ coin: p.coin, from: p.from, to })}`
        : p.kind === "evm"
          ? `evm-sweep?${new URLSearchParams({ chain: p.coin, from: p.from, to, ...(p.token ? { token: p.token } : {}) })}`
          : `fork-sweep?${new URLSearchParams({ chain: p.coin, from: p.from, to })}`;
    try {
      const r = await fetch(`${API_URL}/onchain/${q}`);
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(j.error ?? j.message ?? r.status));
      setRes(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unsigned = res
    ? p.kind === "utxo"
      ? String(res.unsignedTx)
      : JSON.stringify(res.tx, null, 2)
    : "";
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="sweep-recover">
      <SpeechBubble who="swapchan">
        Step 1: tell me where YOUR {p.sym} should go. I build the unsigned transaction; you sign it
        offline in your own wallet. Never type a seed or private key into any website, including
        this one.
      </SpeechBubble>
      <div className="rounded-2xl border-2 border-violet-600 bg-violet-950 p-4 text-sm">
        <p className="text-xs font-bold text-violet-300">Step 1 · build unsigned {p.sym} sweep</p>
        <h1 className="text-xl font-black">{p.title}</h1>
        <p className="mt-2 font-mono text-xs break-all text-violet-300">from {p.from}</p>
        <label className="mt-3 block text-xs font-bold text-violet-300" htmlFor="sweep-to">
          Your {p.sym} destination address
        </label>
        <input
          id="sweep-to"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          className="mt-1 w-full rounded-lg border border-violet-500 bg-violet-900 px-3 py-2 font-mono text-xs"
          placeholder={`${p.sym} address you control`}
        />
        <button
          type="button"
          disabled={!to || busy}
          onClick={build}
          className="mt-3 rounded-lg border-2 border-violet-950 bg-amber-400 px-4 py-2 font-black text-violet-950 disabled:opacity-50"
        >
          {busy ? "Building…" : "Build unsigned transaction"}
        </button>
        {err ? <p className="mt-2 text-rose-300">{err}</p> : null}
      </div>
      {res ? (
        <div className="rounded-2xl border-2 border-emerald-500 bg-violet-950 p-4 text-sm">
          <p className="text-xs font-bold text-emerald-300">Unsigned (not broadcast)</p>
          <textarea
            readOnly
            value={unsigned}
            className="mt-2 h-40 w-full rounded bg-violet-900 p-2 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(unsigned)}
            className="mt-2 rounded border border-violet-400 px-3 py-1 text-xs font-bold"
          >
            Copy
          </button>
          <p className="mt-3 text-violet-200">{String(res.signing ?? "")}</p>
          {res.note ? <p className="mt-1 text-amber-300">{String(res.note)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
