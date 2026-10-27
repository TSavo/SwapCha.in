import { getAddress } from "viem";

/**
 * Display form of an address a user may act on: always the FULL value, never shortened
 * (lookalike/poisoning addresses copy the first and last few characters).
 * EVM hex addresses are EIP-55 checksummed with viem getAddress; everything else
 * (Bitcoin, Solana, Tron, ...) is returned exactly as given.
 */
export function fullAddress(a: string): string {
  if (typeof a !== "string") return a;
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) {
    try {
      return getAddress(a.toLowerCase());
    } catch {
      return a;
    }
  }
  return a;
}
