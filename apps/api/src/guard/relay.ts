import { getOrderId, type VmType } from "@relay-protocol/settlement-sdk";
import { type Hex, parseAbi } from "viem";
import { decodeFunctionData } from "../blocktools.js";
import { RELAY_DEPOSITORY_PINS } from "./relayPins.js";

/**
 * Relay Protocol v2 order verification (docs.relay.link .../input-validation).
 * Relay's API has no pre-deposit lookup for a requestId (intents/status only says "waiting",
 * /requests only lists submitted deposits), so the quote is requested with
 * includeProtocolData and verified locally: recompute the order id from orderData, check the
 * order's recipient / min output / input payment, and bind the deposit tx to that order id
 * at Relay's canonical depository (pinned in relayPins.ts, never from the quote or /chains).
 * A /chains depository that disagrees with the pin fails closed, and a source chain with no pin
 * is refused (RELAY_CHAIN_NOT_PINNED) before /chains is even fetched.
 */
export interface RelayOrder {
  orderId: string;
  orderData: any;
}
export interface RelayProtocol {
  /** protocol chain name ("base") -> VM type, for getOrderId. */
  vmTypes: Record<string, VmType>;
  /** numeric chain id -> { protocol chain name, canonical depository (lowercase) }. */
  chains: Record<
    number,
    {
      name: string;
      depository?: string;
      /** "pinned" = /chains matched the pin. Unpinned chains get no depository (fail closed). */
      source?: "pinned";
      /** /chains disagreed with the pin: depository is withheld and deposits are refused. */
      mismatch?: { api: string; pinned: string };
    }
  >;
}

const normDep = (a: string) => (/^0x/i.test(a) ? a.toLowerCase() : a);

/** Logs a pin disagreement (once per chain+address per process) so the operator sees it. */
const warned = new Set<string>();
function alertMismatch(chainId: number, api: string, pinned: string) {
  const k = `${chainId}:${api}`;
  if (warned.has(k)) return;
  warned.add(k);
  console.error(
    `[ALERT relay-depository-pin] chain ${chainId}: Relay /chains depository ${api} != pinned ${pinned}; refusing Relay deposits on this chain`,
  );
}

const VM: Record<string, VmType> = {
  bvm: "bitcoin-vm",
  evm: "ethereum-vm",
  hypevm: "hyperliquid-vm",
  lvm: "lighter-vm",
  svm: "solana-vm",
  tonvm: "ton-vm",
  tvm: "tron-vm",
  xrpvm: "xrp-vm",
} as never;

export function relayProtocolFromChains(
  chains: {
    id: number;
    vmType?: string;
    protocol?: { v2?: { chainId?: string; depository?: string } };
  }[],
  pins: Readonly<Record<number, string>> = RELAY_DEPOSITORY_PINS,
): RelayProtocol {
  const out: RelayProtocol = { vmTypes: {}, chains: {} };
  for (const c of chains) {
    const p = c.protocol?.v2;
    if (!p?.chainId || !c.vmType || !VM[c.vmType]) continue;
    out.vmTypes[p.chainId] = VM[c.vmType]!;
    const pinned = pins[c.id];
    const api = p.depository ? normDep(p.depository) : undefined;
    if (pinned && api && api !== normDep(pinned)) {
      alertMismatch(c.id, api, normDep(pinned));
      out.chains[c.id] = { name: p.chainId, mismatch: { api, pinned: normDep(pinned) } };
    } else if (pinned) {
      out.chains[c.id] = { name: p.chainId, depository: normDep(pinned), source: "pinned" };
    } else {
      // Unpinned: name only (needed for destination checks). The /chains depository is NOT used.
      out.chains[c.id] = { name: p.chainId };
    }
  }
  return out;
}

/** Error code for a Relay deposit from a chain with no confirmed depository pin. */
export const RELAY_CHAIN_NOT_PINNED = "RELAY_CHAIN_NOT_PINNED";
/** True when SwapChan has a confirmed Relay depository pin for this chain. */
export const relayChainPinned = (
  chainId: number,
  pins: Readonly<Record<number, string>> = RELAY_DEPOSITORY_PINS,
) => Object.hasOwn(pins, chainId) && !!pins[chainId];
export const relayNotPinnedMessage = (chainId: number) =>
  `${RELAY_CHAIN_NOT_PINNED}: chain ${chainId} has no confirmed Relay depository pin; SwapChan refuses Relay deposits from it (no fallback to Relay's /chains list) until the depository is confirmed`;

const DEPOSIT_ABI = parseAbi([
  "function depositNative(address depositor,bytes32 id)",
  "function depositErc20(address depositor,address token,uint256 amount,bytes32 id)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
const lc = (s: string) => String(s).toLowerCase();
/** EVM addresses compare case-insensitively; base58 etc. exactly. */
const sameAddr = (a: string, b: string) =>
  /^0x/i.test(a) && /^0x/i.test(b) ? lc(a) === lc(b) : a === b;

export interface RelayCheckInput {
  order: RelayOrder | undefined;
  proto: RelayProtocol | undefined;
  tx: { to: string; data: string; value: string };
  fromChainId: number;
  toChainId: number;
  /** Sell token as the order encodes it (native = zero address). */
  fromCurrency: string;
  toCurrency: string;
  amount: bigint;
  taker: string;
  recipient: string;
  /** Lowest acceptable guaranteed output. */
  minOut: bigint;
  nowSec?: number;
}
type Sink = { ok(n: string, d?: string): void; bad(n: string, d: string): void };

/** Runs every Relay order check into `c`; any failure rejects the payload. */
export function checkRelayOrder(c: Sink, i: RelayCheckInput) {
  const { order, proto } = i;
  if (!order?.orderId || !order.orderData)
    return c.bad(
      "relayOrder",
      "Relay deposit without protocol order data: cannot verify recipient/minOut",
    );
  if (!proto) return c.bad("relayOrder", "Relay /chains protocol metadata unavailable");
  const od = order.orderData;
  let computed: string;
  try {
    computed = getOrderId(od, proto.vmTypes);
  } catch (e) {
    return c.bad("relayOrder", `cannot recompute order id: ${(e as Error).message}`);
  }
  if (lc(computed) !== lc(order.orderId))
    return c.bad("relayOrder", `order id ${order.orderId} != recomputed ${computed}`);
  c.ok("relayOrder", `order ${computed} recomputed from orderData`);

  const src = proto.chains[i.fromChainId];
  const dst = proto.chains[i.toChainId];
  if (src?.mismatch)
    return c.bad(
      "depository",
      `Relay's chain list reports depository ${src.mismatch.api} for chain ${i.fromChainId}, but the pinned depository is ${src.mismatch.pinned}; refusing to use it`,
    );
  if (!src?.depository || !dst)
    return c.bad("depository", `no Relay protocol chain for ${i.fromChainId}->${i.toChainId}`);
  if (lc(i.tx.to) !== src.depository)
    return c.bad(
      "depository",
      `tx.to ${i.tx.to} is not Relay's canonical depository ${src.depository}`,
    );
  c.ok("depository", `pinned Relay depository ${src.depository} (chain list agrees)`);

  let fn: string;
  let args: readonly unknown[];
  try {
    ({ functionName: fn, args } = decodeFunctionData({ abi: DEPOSIT_ABI, data: i.tx.data as Hex }));
  } catch {
    return c.bad("decode", "Relay depository call is not depositNative/depositErc20");
  }
  const id = String(args[args.length - 1]);
  if (lc(id) !== lc(computed)) c.bad("orderBinding", `deposit id ${id} != order id ${computed}`);
  else c.ok("orderBinding");
  const depositor = String(args[0]);
  if (lc(depositor) !== lc(i.taker)) c.bad("depositor", `depositor ${depositor} != taker`);

  // Input payment.
  const inputs = (od.inputs ?? []) as any[];
  const pay = inputs[0]?.payment;
  if (inputs.length !== 1 || !pay) c.bad("inAmount", `order has ${inputs.length} inputs`);
  else {
    const native = lc(pay.currency) === ZERO;
    if (pay.chainId !== src.name) c.bad("inChain", `order pays on ${pay.chainId}, not ${src.name}`);
    if (lc(pay.currency) !== lc(i.fromCurrency))
      c.bad("inToken", `order input ${pay.currency} != ${i.fromCurrency}`);
    if (BigInt(pay.amount) !== i.amount)
      c.bad("inAmount", `order input ${pay.amount} != ${i.amount}`);
    if (native !== (fn === "depositNative"))
      c.bad("depositFn", `${fn} does not match order currency`);
    if (native) {
      if (BigInt(i.tx.value) !== BigInt(pay.amount))
        c.bad("value", `tx value ${i.tx.value} != order input ${pay.amount}`);
    } else {
      if (lc(String(args[1])) !== lc(pay.currency))
        c.bad("inToken", `deposit token ${args[1]} != order currency`);
      if (BigInt(args[2] as bigint) !== BigInt(pay.amount))
        c.bad("inAmount", `deposit amount ${args[2]} != order input`);
      if (BigInt(i.tx.value || "0") !== 0n) c.bad("value", "ERC-20 deposit sends native value");
    }
    for (const r of (inputs[0].refunds ?? []) as any[])
      if (!sameAddr(r.recipient, i.taker) && !sameAddr(r.recipient, i.recipient))
        c.bad("refund", `refund to ${r.recipient}, not taker/recipient`);
  }

  // Output: exactly one payment, to the recipient, in the right token, >= minOut; no calls.
  const out = od.output ?? {};
  const pays = (out.payments ?? []) as any[];
  if (out.chainId !== dst.name)
    c.bad("outChain", `order pays out on ${out.chainId}, not ${dst.name}`);
  if ((out.calls ?? []).length)
    c.bad("calls", `order carries ${(out.calls as unknown[]).length} destination calls`);
  if (pays.length !== 1) c.bad("recipient", `order has ${pays.length} output payments`);
  else {
    const p0 = pays[0];
    if (!sameAddr(p0.recipient, i.recipient))
      c.bad("recipient", `order recipient ${p0.recipient} != ${i.recipient}`);
    else c.ok("recipient", "Relay order output recipient");
    if (!sameAddr(p0.currency, i.toCurrency))
      c.bad("outToken", `order output ${p0.currency} != ${i.toCurrency}`);
    if (BigInt(p0.minimumAmount) < i.minOut)
      c.bad("minOut", `order minimumAmount ${p0.minimumAmount} < bound ${i.minOut}`);
    else c.ok("minOut", `order minimumAmount ${p0.minimumAmount} >= ${i.minOut}`);
  }
  const now = i.nowSec ?? Math.floor(Date.now() / 1000);
  if (!(Number(out.deadline) > now)) c.bad("deadline", `order deadline ${out.deadline} has passed`);
}
