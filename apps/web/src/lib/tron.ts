"use client";

import type { NonEvmTx } from "@swapchan/shared";
import type { Adapter } from "@tronweb3/tronwallet-abstract-adapter";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { TronExpect, TronTxLike } from "@/lib/tronCheck";
import { projectId } from "@/lib/wagmi";

/**
 * Tron wallets through @tronweb3/tronwallet-adapters (TronLink, OKX, Bitget, TokenPocket,
 * Bybit, Gate, WalletConnect, Ledger). The adapters load on demand (dynamic import) the first
 * time a page asks for Tron. We still build every tx ourselves, check it field-by-field before
 * the wallet sees it (lib/tronCheck), and broadcast through TronGrid.
 */
export interface TronWalletOption {
  name: string;
  icon: string;
  installed: boolean;
}
interface State {
  loaded: boolean;
  loading: boolean;
  picking: boolean;
  wallets: TronWalletOption[];
  address: string | undefined;
  active: string | undefined;
  error: string | undefined;
}
let state: State = {
  loaded: false,
  loading: false,
  picking: false,
  wallets: [],
  address: undefined,
  active: undefined,
  error: undefined,
};
let adapters: Adapter[] = [];
const subs = new Set<() => void>();
const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  for (const f of subs) f();
};
const LAST = "swapchan.tronWallet";

const options = (): TronWalletOption[] =>
  adapters.map((a) => ({
    name: a.name,
    icon: a.icon,
    installed: a.readyState === "Found",
  }));
const activeAdapter = () => adapters.find((a) => a.name === state.active);

function watch(a: Adapter) {
  const sync = () => {
    if (state.active === a.name || (!state.active && a.state === "Connected")) {
      set({
        active: a.address ? a.name : state.active === a.name ? undefined : state.active,
        address: a.address ?? undefined,
      });
    }
    set({ wallets: options() });
  };
  a.on("connect", sync);
  a.on("accountsChanged", sync);
  a.on("disconnect", sync);
  a.on("stateChanged", sync);
  a.on("readyStateChanged", sync);
}

let loading: Promise<void> | null = null;
/** Load the adapters (once). Restores a still-connected wallet without prompting. */
export function loadTron(): Promise<void> {
  if (loading) return loading;
  set({ loading: true });
  loading = import("@/lib/tronWallets")
    .then(async (m) => {
      adapters = await m.createTronAdapters(projectId);
      for (const a of adapters) watch(a);
      const last = typeof localStorage !== "undefined" ? localStorage.getItem(LAST) : null;
      const live =
        adapters.find((a) => a.name === last && a.state === "Connected" && a.address) ??
        adapters.find((a) => a.state === "Connected" && a.address);
      set({
        loaded: true,
        loading: false,
        wallets: options(),
        active: live?.name,
        address: live?.address ?? undefined,
      });
    })
    .catch((e) => {
      loading = null;
      set({ loading: false, error: `Tron wallets failed to load: ${(e as Error).message}` });
    });
  return loading;
}

export async function connectTron(name: string) {
  const a = adapters.find((x) => x.name === name);
  if (!a) return;
  set({ error: undefined });
  try {
    await a.connect();
    if (!a.address) throw new Error("wallet returned no address");
    localStorage.setItem(LAST, a.name);
    set({ active: a.name, address: a.address, picking: false });
  } catch (e) {
    set({ error: (e as Error).message.split("\n")[0] });
  }
}
export const closeTronPicker = () => set({ picking: false, error: undefined });
export async function disconnectTron() {
  await activeAdapter()
    ?.disconnect()
    .catch(() => {});
  localStorage.removeItem(LAST);
  set({ active: undefined, address: undefined });
}

export const useTronState = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );

export interface TronWallet {
  address: string | undefined;
  /** Always true: WalletConnect / Ledger work without an extension. */
  available: boolean;
  wallet: string | undefined;
  open: () => void;
  load: () => void;
}

/** `autoload` (Tron/recover pages) loads the adapters on mount; otherwise on first open(). */
export function useTron(autoload = false): TronWallet {
  const s = useTronState();
  useEffect(() => {
    if (autoload) void loadTron();
  }, [autoload]);
  const open = useCallback(() => {
    set({ picking: true });
    void loadTron();
  }, []);
  const load = useCallback(() => void loadTron(), []);
  return { address: s.address, available: true, wallet: s.active, open, load };
}

// ---------- signing ----------

interface TronWebLike {
  fullNode: { request: (url: string, body: unknown, method: string) => Promise<any> };
  trx: {
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
}
let node: TronWebLike | null = null;
/** Keyless TronGrid client: builds unsigned txs and broadcasts signed ones. Never holds a key. */
async function tronNode(): Promise<TronWebLike> {
  if (node) return node;
  const { TronWeb } = await import("tronweb");
  node = new TronWeb({ fullHost: "https://api.trongrid.io" }) as unknown as TronWebLike;
  return node;
}

/** POST to TronGrid's wallet API (unsigned tx builders). */
export async function tronNodeRequest(path: string, body: unknown): Promise<any> {
  return (await tronNode()).fullNode.request(path, body, "post");
}

function signer(): { a: Adapter; from: string } {
  const a = activeAdapter();
  if (!a?.address || a.address !== state.address) throw new Error("Connect a Tron wallet first");
  return { a, from: a.address };
}

/** Check the tx, have the wallet sign exactly those bytes, broadcast. Refuses any mismatch. */
export async function signCheckedTron(tx: TronTxLike, exp: TronExpect): Promise<string> {
  const { a, from } = signer();
  const c = await import("@/lib/tronCheck");
  const bad = c.checkTronTx(tx, { ...exp, owner: from });
  if (bad) throw new Error(`Refusing to sign: ${bad}`);
  const signed = (await a.signTransaction(tx as never)) as TronTxLike;
  if (!c.signedMatches(tx, signed))
    throw new Error("Refusing to send: the wallet changed the transaction");
  const r = await (await tronNode()).trx.sendRawTransaction(signed);
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
  const { from } = signer();
  const w = await tronNode();
  const { approveData, sameTronAddress } = await import("@/lib/tronCheck");
  if (p.kind === "tvm-deposit") {
    const d = p.data as { to: string; amount: string; memo: string };
    let tx = await w.transactionBuilder.sendTrx(d.to, Number(d.amount), from);
    tx = await w.transactionBuilder.addUpdateData(tx, d.memo, "utf8");
    return signCheckedTron(tx, {
      owner: from,
      type: "TransferContract",
      value: { to_address: d.to, amount: d.amount },
      memo: d.memo,
    });
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
      if (!sameTronAddress(c.parameter.owner_address, from))
        throw new Error("Refusing to sign: call is for a different Tron wallet");
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
      last = await signCheckedTron(r.transaction, {
        owner: from,
        type: "TriggerSmartContract",
        value: {
          contract_address: c.parameter.contract_address,
          data: c.parameter.data,
          call_value: c.parameter.call_value ?? 0,
        },
        feeLimitMax: 150_000_000,
      });
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
      await confirmed(
        w,
        await signCheckedTron(a.transaction, {
          owner: from,
          type: "TriggerSmartContract",
          value: {
            contract_address: d.approve.token,
            data: approveData(d.approve.spender, d.approve.amount),
            call_value: 0,
          },
          feeLimitMax: 100_000_000,
        }),
      );
    }
    const { utils } = await import("tronweb");
    const hex = d.raw.replace(/^0x/, "");
    const tx = {
      visible: false,
      txID: utils.ethersUtils.sha256(`0x${hex}`).slice(2),
      raw_data_hex: hex,
      raw_data: utils.deserializeTx.deserializeTransaction("TriggerSmartContract", hex),
    };
    // Provider raw tx (verified server-side): the bytes are decoded from the hex itself, so we
    // pin the sender and the contract/data/value we decoded and refuse anything else.
    const v = (tx.raw_data as TronTxLike["raw_data"])?.contract?.[0]?.parameter?.value ?? {};
    return signCheckedTron(tx, {
      owner: from,
      type: "TriggerSmartContract",
      value: {
        contract_address: String(v.contract_address ?? ""),
        data: String(v.data ?? ""),
        call_value: String(v.call_value ?? 0),
      },
    });
  }
  throw new Error("Empty Tron payload");
}
