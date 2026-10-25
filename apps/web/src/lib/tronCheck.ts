import { TronWeb, utils } from "tronweb";

/**
 * Pre-sign check for the Tron transaction we are about to hand to the wallet. The node
 * (TronGrid / wallet RPC) builds the tx JSON; we re-encode that JSON locally (tronweb txCheck)
 * so raw_data_hex and txID — the bytes the wallet signs — must match the fields we inspect, then
 * compare every field against what we asked for. Anything we can't decode is refused.
 * (blocktools tronDecodeTx is Node-only for now; swap this to its browser build when it ships.)
 */
export interface TronExpect {
  owner: string;
  type: string;
  value: Record<string, string | number | undefined>;
  /** utf-8 memo the tx must carry in raw_data.data (undefined: must carry none). */
  memo?: string;
  feeLimitMax?: number;
}

export interface TronTxLike {
  txID?: string;
  raw_data_hex?: string;
  raw_data?: {
    contract?: { type?: string; parameter?: { value?: Record<string, unknown> } }[];
    data?: string;
    fee_limit?: number;
  };
}

const ADDR_KEYS = new Set(["owner_address", "to_address", "contract_address", "receiver_address"]);
const NUM_KEYS = new Set(["amount", "call_value", "balance", "unfreeze_balance"]);

const hexAddr = (a: unknown): string | null => {
  if (typeof a !== "string" || !a) return null;
  try {
    const h = TronWeb.address.toHex(a).toLowerCase().replace(/^0x/, "");
    return /^41[0-9a-f]{40}$/.test(h) ? h : null;
  } catch {
    return null;
  }
};
const num = (v: unknown): bigint | null => {
  if (v === undefined || v === null || v === "") return 0n;
  try {
    return BigInt(String(v));
  } catch {
    return null;
  }
};
const hex = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/^0x/, "");
const utf8Hex = (s: string) =>
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

function same(key: string, want: unknown, got: unknown): boolean {
  if (ADDR_KEYS.has(key)) {
    const w = hexAddr(want);
    return w !== null && w === hexAddr(got);
  }
  if (NUM_KEYS.has(key)) {
    const w = num(want);
    return w !== null && w === num(got);
  }
  if (key === "resource") return String(want ?? "BANDWIDTH") === String(got ?? "BANDWIDTH");
  if (key === "data") return hex(want) === hex(got);
  return String(want) === String(got);
}

export const sameTronAddress = (a: unknown, b: unknown) => {
  const x = hexAddr(a);
  return x !== null && x === hexAddr(b);
};

/** null when the tx is exactly what we asked to sign, else the refusal reason. */
export function checkTronTx(tx: TronTxLike, exp: TronExpect): string | null {
  const cs = tx?.raw_data?.contract;
  if (!Array.isArray(cs) || cs.length !== 1) return "expected exactly one Tron contract";
  const c = cs[0]!;
  if (c.type !== exp.type) return `unexpected Tron contract ${c.type ?? "?"}`;
  let ok = false;
  try {
    ok = utils.transaction.txCheck(tx);
  } catch {
    ok = false;
  }
  if (!ok) return "transaction bytes do not match its fields";
  const v = c.parameter?.value ?? {};
  if (!same("owner_address", exp.owner, v.owner_address))
    return "transaction is not from the connected Tron wallet";
  for (const [k, want] of Object.entries(exp.value)) {
    if (k === "owner_address") continue;
    if (!same(k, want, v[k])) return `${k.replace(/_/g, " ")} does not match what we asked to sign`;
  }
  const memo = hex(tx.raw_data?.data);
  if ((exp.memo ? utf8Hex(exp.memo) : "") !== memo) return "memo does not match";
  if (exp.feeLimitMax !== undefined && (tx.raw_data?.fee_limit ?? 0) > exp.feeLimitMax)
    return "fee limit too high";
  return null;
}

/** ERC-20 style approve(spender, amount) calldata for an exact amount. */
export function approveData(spender: string, amount: string): string {
  const s = hexAddr(spender);
  if (!s) throw new Error("bad spender");
  return `095ea7b3${s.slice(2).padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`;
}

/** The wallet must sign the same bytes we checked. */
export function signedMatches(before: TronTxLike, signed: TronTxLike): boolean {
  return (
    !!before.txID &&
    signed?.txID === before.txID &&
    hex(signed.raw_data_hex) === hex(before.raw_data_hex)
  );
}

/** recover/page Tron ops -> the system contract type the node must build. */
export const RECOVER_TYPE: Record<string, string> = {
  withdrawbalance: "WithdrawBalanceContract",
  withdrawexpireunfreeze: "WithdrawExpireUnfreezeContract",
  unfreezebalancev2: "UnfreezeBalanceV2Contract",
  unfreezebalance: "UnfreezeBalanceContract",
  undelegateresource: "UnDelegateResourceContract",
  triggersmartcontract: "TriggerSmartContract",
};
