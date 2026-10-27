import { BITCOIN_CASH, DOGECOIN, isReceiveOnly, LITECOIN, NON_EVM } from "@swapchan/shared";
import { btCashToLegacy, btValidate } from "./blocktools.js";
/** A request this route refuses (HTTP 400 with the message). */
export class RouteRefused extends Error {}

/**
 * Receive-only UTXO destinations (step 1): Litecoin, Dogecoin, Bitcoin Cash, paid out by THORChain.
 * Every address check is blocktools' addressValidate for that exact chain (mainnet only); SwapChan computes no
 * checksum itself. `kinds` = the blocktools address kinds we accept as a payout:
 * - LTC: P2PKH (L...), P2SH (M...), SegWit v0 (ltc1q...). Taproot (ltc1p...) is refused until a THORChain LTC
 *   payout to it is confirmed; the old 3... P2SH form is refused by blocktools as a BTC address.
 * - DOGE: P2PKH (D...), P2SH (A.../9...).
 * - BCH: CashAddr only (bitcoincash:q.../p..., prefix optional). Legacy 1.../3... BCH addresses are byte-identical
 *   to Bitcoin addresses, so a pasted BTC address can't be told apart: refused. The memo carries the prefixless
 *   lowercase form (THORChain memos are colon-separated).
 */
export const UTXO_DEST: Record<
  number,
  { bt: string; thor: string; sym: string; name: string; kinds: readonly string[] }
> = {
  [LITECOIN]: {
    bt: "ltc",
    thor: "LTC.LTC",
    sym: "LTC",
    name: "Litecoin",
    kinds: ["P2pkh", "P2sh", "SegwitV0"],
  },
  [DOGECOIN]: {
    bt: "doge",
    thor: "DOGE.DOGE",
    sym: "DOGE",
    name: "Dogecoin",
    kinds: ["P2pkh", "P2sh"],
  },
  [BITCOIN_CASH]: {
    bt: "bch",
    thor: "BCH.BCH",
    sym: "BCH",
    name: "Bitcoin Cash",
    kinds: ["P2pkh", "P2sh"],
  },
};

export type UtxoAddr = { ok: true; address: string; kind: string } | { ok: false; reason: string };

/** Validate a payout address for a receive-only UTXO chain. Returns the canonical form THORChain gets. */
export function validateUtxoRecipient(chainId: number, raw: string): UtxoAddr {
  const d = UTXO_DEST[chainId];
  if (!d) return { ok: false, reason: `chain ${chainId} is not a receive-only UTXO chain` };
  const a = raw.trim();
  let address = a;
  if (chainId === BITCOIN_CASH) {
    // CashAddr only: blocktools decodes it (checksum verified) or returns null.
    if (btCashToLegacy(a) === null)
      return {
        ok: false,
        reason:
          "Bitcoin Cash: use a CashAddr address (bitcoincash:q... or q...). Legacy 1.../3... addresses look identical to Bitcoin addresses and are refused.",
      };
    address = a.toLowerCase().replace(/^bitcoincash:/, "");
  } else if (/^[a-z]+1/i.test(a)) {
    address = a.toLowerCase(); // bech32 is case-insensitive; mixed case is rejected by blocktools below
    if (a !== a.toLowerCase() && a !== a.toUpperCase())
      return { ok: false, reason: `${d.name}: mixed-case bech32 address` };
  }
  let kind: string | null;
  try {
    kind = btValidate(d.bt, chainId === BITCOIN_CASH ? `bitcoincash:${address}` : address);
  } catch {
    kind = null;
  }
  if (!kind)
    return {
      ok: false,
      reason: `not a valid ${d.name} mainnet address (wrong coin, testnet or bad checksum)`,
    };
  if (!d.kinds.includes(kind))
    return { ok: false, reason: `${d.name}: ${kind} addresses are not accepted as a payout yet` };
  if (address === NON_EVM[chainId]?.native)
    return { ok: false, reason: `${d.name}: that is an unspendable placeholder address` };
  return { ok: true, address, kind };
}

/**
 * Route gate for /quotes and /build. Receive-only chains are refused as origin (clear error) and, as a
 * destination, only THORChain quotes them and the recipient must pass validateUtxoRecipient.
 * Returns the request with the recipient in canonical form.
 */
export function gateUtxoRoute<
  T extends {
    fromChainId: number;
    toChainId: number;
    toToken: string;
    recipient?: string | undefined;
  },
>(req: T): T {
  if (isReceiveOnly(req.fromChainId)) {
    const n = UTXO_DEST[req.fromChainId]!.name;
    throw new RouteRefused(
      `${n} is receive-only on SwapChan for now: it can be the destination of a swap, not the sending chain`,
    );
  }
  if (!isReceiveOnly(req.toChainId)) return req;
  if (req.toToken !== NON_EVM[req.toChainId]!.native)
    throw new RouteRefused(
      `${UTXO_DEST[req.toChainId]!.name}: only the native coin can be received`,
    );
  if (req.recipient === undefined) return req;
  const v = validateUtxoRecipient(req.toChainId, req.recipient);
  if (!v.ok) throw new RouteRefused(`recipient: ${v.reason}`);
  return { ...req, recipient: v.address };
}
