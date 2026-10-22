"use client";

import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import type { BitcoinConnector } from "@reown/appkit-adapter-bitcoin";
import type { NonEvmTx } from "@swapchan/shared";
import { hasAppKit } from "./wagmi";

export interface BitcoinWallet {
  address: string | undefined;
  provider: BitcoinConnector | undefined;
  open: () => void;
}

function useBitcoinAppKit(): BitcoinWallet {
  const { address, isConnected } = useAppKitAccount({ namespace: "bip122" });
  const { walletProvider } = useAppKitProvider<BitcoinConnector>("bip122");
  const { open } = useAppKit();
  return {
    address: isConnected ? address : undefined,
    provider: walletProvider,
    open: () => void open({ view: "Connect", namespace: "bip122" }),
  };
}
const NONE: BitcoinWallet = { address: undefined, provider: undefined, open: () => {} };
const useNone = () => NONE;
/** Bitcoin wallet (Xverse, Leather, Unisat, Phantom, OKX...) via AppKit; inert without Reown. */
export const useBitcoin: () => BitcoinWallet = hasAppKit ? useBitcoinAppKit : useNone;

const isHex = (s: string) => /^[0-9a-fA-F]+$/.test(s);
export const psbtToBase64 = (p: string): string =>
  isHex(p) ? btoa(String.fromCharCode(...(p.match(/../g) ?? []).map((h) => parseInt(h, 16)))) : p;

/** Input indexes in the PSBT that spend from `addr` (what the wallet must sign). */
export async function inputsFor(psbtB64: string, addr: string): Promise<number[]> {
  const { Psbt, address, networks } = await import("bitcoinjs-lib");
  const p = Psbt.fromBase64(psbtB64, { network: networks.bitcoin });
  const out: number[] = [];
  p.data.inputs.forEach((inp, i) => {
    const script = inp.witnessUtxo?.script;
    if (!script) return;
    try {
      if (address.fromOutputScript(script, networks.bitcoin) === addr) out.push(i);
    } catch {
      /* non-standard script: not ours */
    }
  });
  return out;
}

/** Sign + broadcast a provider PSBT (Relay, LI.FI, THORChain). Returns the txid. */
export async function sendBitcoinPsbt(w: BitcoinWallet, p: NonEvmTx): Promise<string> {
  if (!w.provider || !w.address) throw new Error("Connect a Bitcoin wallet first");
  if (p.kind !== "bvm-psbt") throw new Error(`Unsupported Bitcoin payload ${p.kind}`);
  const raw =
    typeof p.data === "string" ? p.data : String((p.data as { psbt?: string }).psbt ?? "");
  const psbt = psbtToBase64(raw);
  const idx = await inputsFor(psbt, w.address);
  if (!idx.length) throw new Error("This PSBT doesn't spend from your connected address");
  const r = await w.provider.signPSBT({
    psbt,
    broadcast: true,
    signInputs: idx.map((index) => ({ address: w.address as string, index, sighashTypes: [1] })),
  });
  if (r.txid) return r.txid;
  // Wallet signed without broadcasting: finalize and push via mempool.space.
  const { Psbt } = await import("bitcoinjs-lib");
  const signed = Psbt.fromBase64(r.psbt);
  signed.finalizeAllInputs();
  const res = await fetch("https://mempool.space/api/tx", {
    method: "POST",
    body: signed.extractTransaction().toHex(),
  });
  if (!res.ok) throw new Error(`Broadcast failed: ${await res.text()}`);
  return await res.text();
}
