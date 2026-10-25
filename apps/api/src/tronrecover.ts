/**
 * Tron recovery on swapchan.com/recover. Tron txs expire in ~60 s, so the link carries a spec
 * (wallet endpoint + body) and the page rebuilds the tx fresh through the user's TronLink.
 * Only self-paying ops are allowed: withdraw rewards/unfrozen TRX, unfreeze, undelegate
 * (resources return to the owner), and contract calls that pay msg.sender (withdraw/redeem/claimAll).
 */
export const TRON_OPS: Record<string, string> = {
  WithdrawBalanceContract: "withdrawbalance",
  WithdrawExpireUnfreezeContract: "withdrawexpireunfreeze",
  UnfreezeBalanceV2Contract: "unfreezebalancev2",
  UnfreezeBalanceContract: "unfreezebalance",
  UnDelegateResourceContract: "undelegateresource",
  TriggerSmartContract: "triggersmartcontract",
};
/** withdraw(uint256) (WTRX, sTRX), redeem(uint256) (JustLend jToken), claimAll(). All pay msg.sender. */
export const TRON_SELECTORS = ["2e1a7d4d", "db006a75", "d1058e59"];
export type TronSpec = { endpoint: string; body: Record<string, unknown> };
const KEEP = [
  "owner_address",
  "resource",
  "unfreeze_balance",
  "receiver_address",
  "balance",
  "contract_address",
  "data",
  "call_value",
];

export function tronSpec(tronTx: unknown): TronSpec | null {
  const c = (
    tronTx as {
      raw_data?: { contract?: { type: string; parameter: { value: Record<string, unknown> } }[] };
    }
  )?.raw_data?.contract;
  if (!c || c.length !== 1) return null;
  const endpoint = TRON_OPS[c[0]!.type];
  if (!endpoint) return null;
  const body = Object.fromEntries(
    Object.entries(c[0]!.parameter.value).filter(([k]) => KEEP.includes(k)),
  );
  return { endpoint, body };
}
export function verifyTronSpec(s: TronSpec, owner: string): boolean {
  if (!Object.values(TRON_OPS).includes(s.endpoint)) return false;
  if (s.body.owner_address !== owner) return false;
  for (const k of Object.keys(s.body)) if (!KEEP.includes(k)) return false;
  if (s.endpoint === "triggersmartcontract") {
    if (Number(s.body.call_value ?? 0) !== 0) return false;
    const d = String(s.body.data ?? "");
    if (
      !TRON_SELECTORS.includes(d.slice(0, 8)) ||
      !/^[0-9a-f]*$/i.test(d) ||
      (d.length !== 8 && d.length !== 72)
    )
      return false;
  }
  return true;
}
export const encodeSpec = (s: TronSpec) => Buffer.from(JSON.stringify(s)).toString("base64url");
