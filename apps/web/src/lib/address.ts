import { getAddress } from "viem";

/**
 * The only way SwapChan shows an address a user may act on: the FULL value, never shortened
 * (address-poisoning lookalikes copy the first and last few characters). EVM hex addresses are
 * EIP-55 checksummed with viem getAddress; Bitcoin, Solana, Tron etc. are shown exactly as given.
 */
export function displayAddress(a: string | null | undefined): string {
  if (!a) return "";
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) {
    try {
      return getAddress(a.toLowerCase());
    } catch {
      return a;
    }
  }
  return a;
}
