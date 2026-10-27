/** Well-known burn / dead addresses: nobody holds a key for them, so nothing sent there is recoverable.
 *  find_money short-circuits on these instead of totalling burned LP NFTs and tokens as "found money". */

// EVM: compared lowercase
const EVM_BURN = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x0000000000000000000000000000000000000001",
  "0x000000000000000000000000000000000000dead",
  "0xdead000000000000000042069420694206942069",
  "0xdead000000000000000000000000000000000000",
  "0x00000000000000000000000000000000deadbeef",
]);

// base58 / other VMs: exact match (case-sensitive)
const EXACT_BURN = new Set([
  // Solana incinerator + system program id
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
  // Tron black hole (base58 of 0x41 00..00)
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  // Bitcoin vanity eater addresses with no known key
  "1BitcoinEaterAddressDontSendf59kuE",
  "1111111111111111111114oLvT2",
]);

export function isBurnAddress(address: string): boolean {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return EVM_BURN.has(a.toLowerCase());
  return EXACT_BURN.has(a);
}

export const BURN_HEADLINE =
  "This is a known burn address: assets sent here can't be recovered by anyone, so nothing is counted as recoverable.";

/** Result for a burn address: same shape as a normal find_money result, plus burnAddress: true. */
export function burnAddressResult(address: string, name?: string | null) {
  return {
    address,
    ...(name ? { name } : {}),
    burnAddress: true as const,
    partial: false,
    incompleteSources: 0,
    portfolioUsd: null,
    headline: BURN_HEADLINE,
    opportunities: 0,
    trust:
      "Trustless: SwapChan never signs, never holds keys or funds, and cannot move money. Every recoveryTx is unsigned; your own wallet signs it.",
    totalEstUsd: 0,
    atRiskUsd: 0,
    items: [] as never[],
    owedNotClaimableNow: [] as never[],
    sources: [] as string[],
    checked: [] as string[],
    notChecked: [] as string[],
    errors: [] as string[],
    asOf: new Date().toISOString(),
    block: null,
    cached: false,
  };
}
