import { createPublicClient, http, parseAbi } from "viem";
import type { Fetch } from "../providers/types.js";
import { CHAINS } from "../simulate.js";
import { type RelayProtocol, relayProtocolFromChains } from "./relay.js";

export interface ThorInbound {
  chain: string;
  address: string;
  router?: string;
  halted?: boolean;
}

/** Live data the guard checks against (cached; tests inject fixed values). */
export interface GuardCtx {
  thorInbound(): Promise<ThorInbound[]>;
  /** Relay contracts + solver addresses for a chain, from api.relay.link/chains. */
  relay(chainId: number): Promise<{ contracts: string[]; solvers: string[] }>;
  /** Relay Protocol v2 chain names, VM types and canonical depositories (GET /chains). */
  relayProtocol?(): Promise<RelayProtocol>;
  /** Override of RELAY_DEPOSITORY_PINS (tests only). */
  relayPins?: Readonly<Record<number, string>>;
  /** Current + previous 0x Settler (taker-submitted, feature 2) from the 0x Deployer registry. */
  zeroxSettlers(chainId: number): Promise<string[]>;
}

const ZEROX_DEPLOYER = "0x00000000000004533Fe15556B1E086BB1A72cEae";
const deployerAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function prev(uint128) view returns (address)",
]);

const cached = <T>(ttl: number, load: () => Promise<T>) => {
  let at = 0;
  let v: Promise<T> | undefined;
  return () => {
    if (!v || Date.now() - at > ttl) {
      at = Date.now();
      v = load().catch((e) => {
        v = undefined;
        throw e;
      });
    }
    return v;
  };
};

export function liveGuardCtx(env: NodeJS.ProcessEnv = process.env, f: Fetch = fetch): GuardCtx {
  const thorBase = env.THORNODE_URL || "https://gateway.liquify.com/chain/thorchain_api/thorchain";
  const inbound = cached(60_000, async () => {
    const r = await f(`${thorBase}/inbound_addresses`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`thornode inbound_addresses ${r.status}`);
    return (await r.json()) as ThorInbound[];
  });
  const relayChains = cached(3_600_000, async () => {
    const r = await f("https://api.relay.link/chains", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`relay chains ${r.status}`);
    return (
      (await r.json()) as {
        chains: {
          id: number;
          vmType?: string;
          protocol?: { v2?: { chainId?: string; depository?: string } };
          contracts?: Record<string, unknown>;
          solverAddresses?: string[];
        }[];
      }
    ).chains;
  });
  const settlers = new Map<number, () => Promise<string[]>>();
  return {
    thorInbound: inbound,
    relayProtocol: async () => relayProtocolFromChains(await relayChains()),
    zeroxSettlers(chainId) {
      let g = settlers.get(chainId);
      if (!g) {
        g = cached(600_000, async () => {
          const chain = CHAINS[chainId];
          if (!chain) return [];
          const c = createPublicClient({ chain, transport: http(env[`RPC_URL_${chainId}`]) });
          const read = (functionName: "ownerOf" | "prev") =>
            c
              .readContract({ address: ZEROX_DEPLOYER, abi: deployerAbi, functionName, args: [2n] })
              .then((a) => a.toLowerCase())
              .catch(() => null);
          const xs = (await Promise.all([read("ownerOf"), read("prev")])).filter(
            (x): x is string => !!x,
          );
          if (!xs.length) throw new Error("0x deployer registry unreachable");
          return xs;
        });
        settlers.set(chainId, g);
      }
      return g().catch(() => []);
    },
    async relay(chainId) {
      const c = (await relayChains().catch(() => [])).find((x) => x.id === chainId);
      const contracts: string[] = [];
      const walk = (o: unknown) => {
        if (typeof o === "string" && /^0x[0-9a-fA-F]{40}$/.test(o)) contracts.push(o.toLowerCase());
        else if (o && typeof o === "object") Object.values(o).forEach(walk);
      };
      walk(c?.contracts);
      // multicall3 is a public utility, not a Relay contract: never a valid tx target.
      const m3 = "0xca11bde05977b3631167028862be2a173976ca11";
      const mc = "0x0000000000002bdbf1bf3279983603ec279cc6df";
      return {
        contracts: contracts.filter((x) => x !== m3 && x !== mc),
        solvers: c?.solverAddresses ?? [],
      };
    },
  };
}
