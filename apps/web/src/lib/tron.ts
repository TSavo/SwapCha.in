"use client";

import type { NonEvmTx } from "@swapchan/shared";
import { useCallback, useEffect, useState } from "react";

/** Minimal TronLink-injected TronWeb surface we use. */
interface TronWebLike {
  defaultAddress: { base58: string | false };
  fullNode: { request: (url: string, body: unknown, method: string) => Promise<any> };
  trx: {
    sign: (tx: unknown) => Promise<any>;
    sendRawTransaction: (
      tx: unknown,
    ) => Promise<{ result?: boolean; txid?: string; code?: string; message?: string }>;
    getTransactionInfo: (id: string) => Promise<{ receipt?: { result?: string } }>;
  };
  transactionBuilder: {
    sendTrx: (to: string, amount: number, from: string) => Promise<any>;
    addUpdateData: (tx: unknown, data: string, enc: string) => Promise<any>;
    triggerSmartContract: (
      contract: string,
      fn: string,
      opts: { feeLimit: number },
      params: { type: string; value: string }[],
      from: string,
    ) => Promise<{ transaction: any }>;
  };
  address: { toHex: (a: string) => string };
}
declare global {
  interface Window {
    tronLink?: { request: (a: { method: string }) => Promise<{ code?: number } | undefined> };
    tronWeb?: TronWebLike;
  }
}

export interface TronWallet {
  address: string | undefined;
  available: boolean;
  open: () => void;
}

/** TronLink (and TronLink-compatible injected wallets: OKX, Bitget, TokenPocket). */
export function useTron(): TronWallet {
  const [address, setAddress] = useState<string | undefined>();
  const [available, setAvailable] = useState(false);
  const sync = useCallback(() => {
    const a = typeof window !== "undefined" ? window.tronWeb?.defaultAddress?.base58 : false;
    setAddress(a || undefined);
    setAvailable(typeof window !== "undefined" && !!(window.tronLink || window.tronWeb));
  }, []);
  useEffect(() => {
    sync();
    const t = setInterval(sync, 1500);
    window.addEventListener("message", sync);
    return () => {
      clearInterval(t);
      window.removeEventListener("message", sync);
    };
  }, [sync]);
  const open = useCallback(() => {
    if (!window.tronLink) {
      window.open("https://www.tronlink.org/", "_blank", "noreferrer");
      return;
    }
    void window.tronLink.request({ method: "tron_requestAccounts" }).then(sync);
  }, [sync]);
  return { address, available, open };
}

const tw = (): TronWebLike => {
  const w = window.tronWeb;
  if (!w?.defaultAddress?.base58) throw new Error("Connect TronLink first");
  return w;
};

async function sendSigned(w: TronWebLike, tx: unknown): Promise<string> {
  const signed = await w.trx.sign(tx);
  const r = await w.trx.sendRawTransaction(signed);
  if (!r.result || !r.txid)
    throw new Error(`Tron rejected the tx: ${r.code ?? ""} ${r.message ?? ""}`.trim());
  return r.txid;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function confirmed(w: TronWebLike, id: string) {
  for (let i = 0; i < 20; i++) {
    const info = await w.trx
      .getTransactionInfo(id)
      .catch(() => ({}) as { receipt?: { result?: string } });
    if (info.receipt) {
      if (info.receipt.result && info.receipt.result !== "SUCCESS")
        throw new Error(`Approve failed: ${info.receipt.result}`);
      return;
    }
    await wait(3000);
  }
}

interface RelayCall {
  parameter: { owner_address: string; contract_address: string; data: string; call_value?: number };
}

/** Sign + send a provider's Tron payload (Relay calls, LI.FI raw tx, THORChain deposit). Returns the main txid. */
export async function sendTron(p: NonEvmTx): Promise<string> {
  const w = tw();
  const from = w.defaultAddress.base58 as string;
  if (p.kind === "tvm-deposit") {
    const d = p.data as { to: string; amount: string; memo: string };
    let tx = await w.transactionBuilder.sendTrx(d.to, Number(d.amount), from);
    tx = await w.transactionBuilder.addUpdateData(tx, d.memo, "utf8");
    return sendSigned(w, tx);
  }
  if (p.kind !== "tvm-json") throw new Error(`Unsupported Tron payload ${p.kind}`);
  const d = p.data as {
    calls?: RelayCall[];
    raw?: string;
    approve?: { token: string; spender: string; amount: string } | null;
  };
  if (d.calls) {
    let last = "";
    for (const [i, c] of d.calls.entries()) {
      const r = await w.fullNode.request(
        "wallet/triggersmartcontract",
        {
          owner_address: c.parameter.owner_address,
          contract_address: c.parameter.contract_address,
          data: c.parameter.data,
          call_value: c.parameter.call_value ?? 0,
          fee_limit: 150_000_000,
          visible: false,
        },
        "post",
      );
      if (!r?.transaction)
        throw new Error(`Tron node: ${JSON.stringify(r?.result ?? r).slice(0, 160)}`);
      last = await sendSigned(w, r.transaction);
      if (i < d.calls.length - 1) await confirmed(w, last);
    }
    return last;
  }
  if (d.raw) {
    if (d.approve) {
      const a = await w.transactionBuilder.triggerSmartContract(
        d.approve.token,
        "approve(address,uint256)",
        { feeLimit: 100_000_000 },
        [
          { type: "address", value: d.approve.spender },
          { type: "uint256", value: d.approve.amount },
        ],
        from,
      );
      await confirmed(w, await sendSigned(w, a.transaction));
    }
    const { utils } = await import("tronweb");
    const hex = d.raw.replace(/^0x/, "");
    const tx = {
      visible: false,
      txID: utils.ethersUtils.sha256(`0x${hex}`).slice(2),
      raw_data_hex: hex,
      raw_data: utils.deserializeTx.deserializeTransaction("TriggerSmartContract", hex),
    };
    return sendSigned(w, tx);
  }
  throw new Error("Empty Tron payload");
}
