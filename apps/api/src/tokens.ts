import { isVmAddress, NATIVE_TOKEN, SOLANA, type Token, tokenList } from "@swapchan/shared";
import { createPublicClient, erc20Abi, getAddress, http, isAddress } from "viem";
import { CHAINS } from "./simulate.js";

export type ResolvedToken = Token & { verified: boolean };
export type SolanaReader = (mint: string) => Promise<ResolvedToken | null>;

/** Any SPL mint via Jupiter's token API; verified = on Jupiter's verified list. */
export function jupiterTokenReader(
  env: NodeJS.ProcessEnv = process.env,
  f: typeof fetch = fetch,
): SolanaReader {
  const headers: Record<string, string> = env.JUPITER_API_KEY
    ? { "x-api-key": env.JUPITER_API_KEY }
    : {};
  return async (mint) => {
    try {
      const r = await f(`https://api.jup.ag/tokens/v2/search?query=${mint}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return null;
      const t = (
        (await r.json()) as {
          id: string;
          symbol: string;
          name: string;
          decimals: number;
          icon?: string;
          isVerified?: boolean;
        }[]
      ).find((x) => x.id === mint);
      if (!t) return null;
      return {
        chainId: SOLANA,
        address: mint as `0x${string}`,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        ...(t.icon?.startsWith("https://") ? { logoURI: t.icon } : {}),
        verified: Boolean(t.isVerified),
      };
    } catch {
      return null;
    }
  };
}
export type TokenReader = (chainId: number, address: `0x${string}`) => Promise<Token | null>;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Reads symbol/name/decimals straight from the chain (viem); null if it isn't an ERC-20 there. */
export function onchainReader(env: NodeJS.ProcessEnv = process.env): TokenReader {
  return async (chainId, address) => {
    const chain = CHAINS[chainId];
    if (!chain) return null;
    const client = createPublicClient({ chain, transport: http(env[`RPC_URL_${chainId}`]) });
    try {
      const [symbol, name, decimals] = await Promise.all(
        (["symbol", "name", "decimals"] as const).map((functionName) =>
          client.readContract({ address, abi: erc20Abi, functionName }),
        ),
      );
      return {
        chainId,
        address: getAddress(address),
        symbol: String(symbol),
        name: String(name),
        decimals: Number(decimals),
      };
    } catch {
      return null;
    }
  };
}

/** Listed tokens are verified; anything else is read on-chain (cached) and flagged unverified. */
export function tokenResolver(read: TokenReader, readSolana?: SolanaReader) {
  const cache = new Map<string, Promise<ResolvedToken | null>>();
  return (chainId: number, address: string): Promise<ResolvedToken | null> => {
    const listed = tokenList.find((t) => t.chainId === chainId && same(t.address, address));
    if (listed) return Promise.resolve({ ...listed, verified: true });
    if (chainId === SOLANA) {
      if (!readSolana || !isVmAddress(address, "svm")) return Promise.resolve(null);
      const key = `${chainId}:${address}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = readSolana(address);
        hit.then((t) => t ?? cache.delete(key));
        cache.set(key, hit);
      }
      return hit;
    }
    if (!isAddress(address, { strict: false })) return Promise.resolve(null);
    if (same(address, NATIVE_TOKEN)) return Promise.resolve(null);
    const key = `${chainId}:${address.toLowerCase()}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = read(chainId, address as `0x${string}`).then((t) =>
        t ? { ...t, verified: false } : null,
      );
      hit.then((t) => t ?? cache.delete(key));
      cache.set(key, hit);
    }
    return hit;
  };
}
