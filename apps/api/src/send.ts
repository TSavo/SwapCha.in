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
import { blocktools, exactJson } from "./blocktools.js";
import { EVM_IDS, resolveName } from "./onchain.js";
import { onchainReader, tokenResolver } from "./tokens.js";

type F = typeof fetch;

/** The connected wallet fills these at sign time; buildEvmTransfer requires them, so they are placeholders. */
const PLACEHOLDER = { nonce: 0, gas: 21000, gasPrice: "1000000000" };

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
export async function buildEvmSend(
  f: F,
  env: NodeJS.ProcessEnv,
  o: { chainId: number; to: string; amount: string; token?: string; from?: string },
): Promise<SendPlan> {
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
  const built = exactJson<{ unsigned: string; to: string; data?: string; value: string }>(
    w.buildEvmTransfer(JSON.stringify(req)),
  );

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
    tx: { to: built.to, data: built.data, value: built.value, chainId: o.chainId },
    verify,
  };
}
