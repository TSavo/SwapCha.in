import { keccak256, toBytes } from "viem";
import type { TypedData } from "./index.js";

/** CoW Protocol orderbook network slug per chain id. */
export const COW_NETWORK: Record<number, string> = {
  1: "mainnet",
  8453: "base",
  42161: "arbitrum_one",
  137: "polygon",
  56: "bnb",
  43114: "avalanche",
  59144: "linea",
};
export const COW_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41" as const;
export const COW_VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110" as const;
export const cowApi = (chainId: number): string => {
  const net = COW_NETWORK[chainId];
  if (!net) throw new Error(`CoW not supported on chain ${chainId}`);
  return `https://api.cow.fi/${net}/api/v1`;
};
export const cowExplorer = (uid: string) => `https://explorer.cow.fi/orders/${uid}`;

const domain = (chainId: number) => ({
  name: "Gnosis Protocol",
  version: "v2",
  chainId,
  verifyingContract: COW_SETTLEMENT,
});

export const COW_ORDER_TYPES = {
  Order: [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "receiver", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" },
    { name: "feeAmount", type: "uint256" },
    { name: "kind", type: "string" },
    { name: "partiallyFillable", type: "bool" },
    { name: "sellTokenBalance", type: "string" },
    { name: "buyTokenBalance", type: "string" },
  ],
};

/** Limit-order appData: orderClass "limit" plus our partner fee (volume bps to recipient). */
export function limitAppData(recipient: string | undefined, bps: number): string {
  const metadata: Record<string, unknown> = { orderClass: { orderClass: "limit" } };
  if (recipient && bps > 0) metadata.partnerFee = { volumeBps: bps, recipient };
  return JSON.stringify({ appCode: "SwapChan", metadata, version: "1.4.0" });
}
/** CoW appData hash: keccak256 of the exact JSON document string. */
export const appDataHash = (doc: string): `0x${string}` => keccak256(toBytes(doc));

export interface LimitOrderParams {
  chainId: number;
  owner: string;
  sellToken: string;
  buyToken: string;
  /** Base units, full amount sold. */
  sellAmount: string;
  /** Base units, minimum received (the limit). */
  buyAmount: string;
  /** Unix seconds. */
  validTo: number;
  appDataHash: string;
  partiallyFillable?: boolean | undefined;
  receiver?: string | undefined;
}

/** EIP-712 typed data for a fee-less CoW sell limit order. */
export function limitOrderTypedData(p: LimitOrderParams): TypedData {
  if (!(p.chainId in COW_NETWORK)) throw new Error(`CoW not supported on chain ${p.chainId}`);
  return {
    domain: domain(p.chainId),
    types: COW_ORDER_TYPES,
    primaryType: "Order",
    message: {
      sellToken: p.sellToken,
      buyToken: p.buyToken,
      receiver: p.receiver ?? p.owner,
      sellAmount: p.sellAmount,
      buyAmount: p.buyAmount,
      validTo: p.validTo,
      appData: p.appDataHash,
      feeAmount: "0",
      kind: "sell",
      partiallyFillable: p.partiallyFillable ?? false,
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
    },
  };
}

/** EIP-712 typed data for an off-chain (gasless) cancellation of one or more orders. */
export function cancellationTypedData(chainId: number, orderUids: string[]): TypedData {
  return {
    domain: domain(chainId),
    types: { OrderCancellations: [{ name: "orderUids", type: "bytes[]" }] },
    primaryType: "OrderCancellations",
    message: { orderUids },
  };
}
