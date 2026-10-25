import { btVerifySweepTx } from "./blocktools.js";
import type { Verdict } from "./recover.js";

/** EIP-3085 wallet_addEthereumChain params, so the /recover page can add a chain the wallet lacks. */
export type AddChain = {
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
};
export const addChainParams = (
  id: number,
  name: string,
  cur: { name: string; symbol: string; decimals: number },
  rpcUrls: readonly string[],
  explorer?: string,
): AddChain => ({
  chainId: `0x${id.toString(16)}`,
  chainName: name,
  nativeCurrency: { name: cur.name, symbol: cur.symbol, decimals: cur.decimals },
  rpcUrls: [...rpcUrls],
  ...(explorer ? { blockExplorerUrls: [explorer] } : {}),
});

/**
 * Fail-closed check for a fork / extra-EVM sweep: it must be an EIP-155 tx (chainId set, equal to the expected chain)
 * from the owner that can only pay the owner: native value straight to the owner with no calldata, or a zero-value
 * ERC-20 transfer(owner, amount) on the expected token. blocktools wasm verifier (throws if unavailable).
 */
export function verifySweepTx(tx: object, owner: string, chainId: number, token?: string): Verdict {
  return btVerifySweepTx(tx, owner, chainId, token ?? "");
}
