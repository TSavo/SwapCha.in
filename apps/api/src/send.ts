// A plain send: move a token (or the native coin) to an arbitrary recipient, as an UNSIGNED transaction
// the user's own wallet signs. SwapChan never holds keys, signs or broadcasts. This is the piece the
// wallet was missing — swaps could pay a recipient and recovery could sweep back to yourself, but there
// was no first-class "send X to Y". The transaction is CONSTRUCTED by blocktools (the vendored keyless
// wasm: buildEvmTransfer for EVM) and then independently re-checked with verifyTx against the recipient,
// so an assembly bug can't send to the wrong place or the wrong amount.
//
// EVM is implemented here; UTXO (btBuildPsbt), Solana (solBuildTransfer) and Tron (tronBuildTransfer)
// are the same shape and land next. For EVM the wallet fills the real nonce/gas/fees at sign time, so we
// build with placeholders — only `to`, `value` and the `data` (calldata) are load-bearing.
import { getAddress, isAddress, parseUnits } from "viem";
import { blocktools } from "./blocktools.js";
import { EVM_IDS, resolveName } from "./onchain.js";
import { buildSolSend, type SolSendPlan } from "./sendsol.js";
import { buildTronSend, type TronSendPlan } from "./sendtron.js";
import { buildUtxoSend, type UtxoSendPlan } from "./sendutxo.js";
import { onchainReader, tokenResolver } from "./tokens.js";
import { COINS } from "./utxochains.js";

type F = typeof fetch;

/** The connected wallet fills these at sign time; buildEvmTransfer requires them, so they are placeholders. */
const PLACEHOLDER = { nonce: 0, gas: 21000, gasPrice: "1000000000" };

/** Common EVM chain names/aliases -> chainId (ids from onchain.ts EVM_IDS). Numeric ids also accepted. */
const EVM_NAMES: Record<string, number> = {
  ethereum: 1, eth: 1, mainnet: 1,
  base: 8453,
  arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  polygon: 137, matic: 137,
  bnb: 56, bsc: 56, "bnb chain": 56,
  avalanche: 43114, avax: 43114,
  linea: 59144,
  scroll: 534352,
};

export type SendArgs = {
  chain: string; // an EVM chainId (e.g. "8453"), an EVM name ("base"), or a UTXO coin slug ("btc")
  to: string;
  amount: string;
  token?: string | undefined;
  from?: string | undefined;
};

/** Resolve the `chain` field to a chain family. */
function resolveChain(
  chain: string,
): { evm: number } | { coin: string } | { svm: true } | { tvm: true } {
  const s = chain.trim().toLowerCase();
  const n = Number(s);
  if (Number.isInteger(n) && EVM_IDS.includes(n)) return { evm: n };
  if (EVM_NAMES[s] !== undefined) return { evm: EVM_NAMES[s]! };
  if (s === "sol" || s === "solana") return { svm: true };
  if (s === "tron" || s === "trx") return { tvm: true };
  if (s === "btc" || s === "bitcoin") return { coin: "btc" }; // Bitcoin is handled via btc.ts, not COINS
  if (Object.prototype.hasOwnProperty.call(COINS, s)) return { coin: s };
  throw new Error(
    `can't send on "${chain}": not a supported chain. EVM (name or id): ${Object.keys(EVM_NAMES).join(", ")}; Solana (sol); Tron (tron); UTXO coins: btc, ${Object.keys(COINS).join(", ")}.`,
  );
}

/**
 * Build an unsigned send on any supported chain, dispatched by chain family. EVM and UTXO (Bitcoin +
 * forks) are live; Solana and Tron are coming — until then they return a clear, non-silent error so the
 * agent never implies a send it can't build.
 */
export async function buildSend(
  f: F,
  env: NodeJS.ProcessEnv,
  a: SendArgs,
): Promise<SendPlan | UtxoSendPlan | SolSendPlan | TronSendPlan> {
  const r = resolveChain(a.chain);
  if ("evm" in r)
    return buildEvmSend(f, env, {
      chainId: r.evm,
      to: a.to,
      amount: a.amount,
      token: a.token,
      from: a.from,
    });
  if ("svm" in r)
    return buildSolSend(f, env, { to: a.to, amount: a.amount, token: a.token, from: a.from });
  if ("tvm" in r)
    return buildTronSend(f, env, { to: a.to, amount: a.amount, token: a.token, from: a.from });
  return buildUtxoSend(f, env, { coin: r.coin, to: a.to, amount: a.amount, from: a.from });
}

type EvmSendArgs = {
  chainId: number;
  to: string;
  amount: string;
  token?: string | undefined;
  from?: string | undefined;
};

export type SendPlan = {
  family: "evm";
  chainId: number;
  recipient: string;
  token: string | null; // token contract (ERC-20), or null for the native coin
  amount: string; // the decimal amount the user asked to send
  /** the unsigned-transaction fields the wallet signs (EIP-1193 shape); the wallet sets nonce/gas/fees */
  tx: { to: string; data?: string | undefined; value: string; chainId: number };
  verify: { ok: boolean; failures: string[]; warnings: string[] } | null;
};

/**
 * Build an unsigned EVM send. `to` is a 0x address or a name (ENS/…); `token` is a token contract (or
 * "native"/omitted for the native coin); `amount` is a human decimal. Returns the unsigned tx + a verifyTx
 * verdict that re-reads the recipient out of the built transaction.
 */
export async function buildEvmSend(f: F, env: NodeJS.ProcessEnv, o: EvmSendArgs): Promise<SendPlan> {
  if (!EVM_IDS.includes(o.chainId)) throw new Error(`unsupported EVM chain ${o.chainId}`);
  const w = blocktools();
  if (!w) throw new Error("blocktools is unavailable; not offering an unverified transaction");
  if (!/^\d+(\.\d+)?$/.test(o.amount.trim()) || Number(o.amount) <= 0)
    throw new Error("amount must be a positive decimal");

  // Resolve the recipient (ENS etc.) to a checksummed 0x address.
  let to = o.to.trim();
  if (!isAddress(to)) {
    const r = (await resolveName(f, env, to)) as { address?: string } | null;
    if (!r?.address || !isAddress(r.address)) throw new Error(`could not resolve recipient "${o.to}"`);
    to = r.address;
  }
  to = getAddress(to);

  // Resolve the token (for decimals). Omitted / "native" → the native coin (18 decimals).
  let decimals = 18;
  let token: string | null = null;
  const t = o.token?.trim();
  if (t && t.toLowerCase() !== "native") {
    if (!isAddress(t)) throw new Error("token must be a 0x contract address (or omit it for the native coin)");
    const resolved = await tokenResolver(onchainReader(env))(o.chainId, t);
    if (!resolved) throw new Error(`"${t}" is not an ERC-20 on chain ${o.chainId}`);
    decimals = resolved.decimals;
    token = getAddress(t);
  }

  const value = parseUnits(o.amount as `${number}`, decimals).toString();
  // buildEvmTransfer with `token` emits transfer(recipient, value) with tx.to = the token; without it, a
  // native transfer with tx.to = the recipient. Placeholder nonce/gas/gasPrice; the wallet sets real ones.
  const req: Record<string, unknown> = {
    chainId: o.chainId,
    nonce: PLACEHOLDER.nonce,
    gas: PLACEHOLDER.gas,
    gasPrice: PLACEHOLDER.gasPrice,
    to,
    value,
  };
  if (token) req.token = token;
  if (o.from && isAddress(o.from)) req.from = getAddress(o.from);
  // Plain parse (not exactJson): buildEvmTransfer's `fee`/token `amount` don't carry the `_str` twin.
  const built = JSON.parse(w.buildEvmTransfer(JSON.stringify(req))) as {
    unsigned: string;
    to: string;
    data?: string;
    value: string;
  };

  // Independent guard: verifyTx re-decodes the built tx and confirms it pays the intended recipient. For a
  // token transfer verifyTx reads the recipient out of the calldata; for native it checks tx.to.
  let verify: SendPlan["verify"] = null;
  const vraw = w.verifyTx(built.unsigned, "eth", [to], [], o.chainId, "", false, null, null);
  const v = JSON.parse(vraw) as { ok?: boolean; failures?: string[]; warnings?: string[] };
  verify = { ok: v.ok === true, failures: v.failures ?? [], warnings: v.warnings ?? [] };

  return {
    family: "evm",
    chainId: o.chainId,
    recipient: to,
    token,
    amount: o.amount,
    // native send has empty ("0x") calldata — drop it so the tx is a clean {to, value}
    tx: {
      to: built.to,
      ...(built.data && built.data !== "0x" ? { data: built.data } : {}),
      value: built.value,
      chainId: o.chainId,
    },
    verify,
  };
}
