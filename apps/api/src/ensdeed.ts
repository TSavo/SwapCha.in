import { encodeFunctionData, getAddress, keccak256, parseAbiItem, toHex, formatEther } from "viem";
import { NATIVE_TOKEN } from "@swapchan/shared";
import { evmClient, prices, pxOf, swapUrl, usdcOf } from "./onchain.js";
import type { NewFound } from "./recover.js";

type F = typeof fetch;
/** ENS auction registrar (2017-2019). Each .eth bid locked ETH in a Deed contract; after the 2019 migration the deed
 *  owner can still call releaseDeed(labelHash) on this registrar to get the whole deposit back. */
export const OLD_REGISTRAR = "0x6090A6e47849629b7245Dfa1Ca21D94cd15878Ef";
export const HASH_REGISTERED = keccak256(toHex("HashRegistered(bytes32,address,uint256,uint256)"));
const ENTRIES = parseAbiItem("function entries(bytes32) view returns (uint8, address, uint256, uint256, uint256)");
const OWNER = parseAbiItem("function owner() view returns (address)");
const RELEASE = parseAbiItem("function releaseDeed(bytes32 _hash)");
export const releaseDeedTx = (hash: `0x${string}`) => ({
  chainId: 1, to: OLD_REGISTRAR, value: "0",
  data: encodeFunctionData({ abi: [RELEASE], args: [hash] }),
  description: "releaseDeed: returns the whole ENS deed deposit to the deed owner (you)",
});

async function registeredHashes(f: F, env: NodeJS.ProcessEnv, owner: string): Promise<string[]> {
  const t2 = "0x" + owner.slice(2).toLowerCase().padStart(64, "0");
  const q = `module=logs&action=getLogs&address=${OLD_REGISTRAR}&topic0=${HASH_REGISTERED}&topic2=${t2}&topic0_2_opr=and&fromBlock=3600000&toBlock=latest`;
  const urls = [
    ...(env.ETHERSCAN_API_KEY ? [`https://api.etherscan.io/v2/api?chainid=1&${q}&apikey=${env.ETHERSCAN_API_KEY}`] : []),
    `https://eth.blockscout.com/api?${q}`,
  ];
  for (const u of urls) {
    const r = await f(u, { signal: AbortSignal.timeout(6000) }).then((x) => x.json() as Promise<{ status?: string; message?: string; result?: unknown }>).catch(() => null);
    if (r && Array.isArray(r.result)) return [...new Set((r.result as { topics: string[] }[]).map((l) => l.topics[1]!))];
    if (r && /no records/i.test(String(r.message))) return [];
  }
  throw new Error("ENS registrar logs unavailable");
}

export async function ensDeeds(f: F, env: NodeJS.ProcessEnv, owner: `0x${string}`): Promise<NewFound[]> {
  const hashes = await registeredHashes(f, env, owner);
  if (!hashes.length) return [];
  const cl = evmClient(1, env);
  const found = (await Promise.all(hashes.slice(0, 60).map(async (h) => {
    const e = (await cl.readContract({ address: OLD_REGISTRAR, abi: [ENTRIES], functionName: "entries", args: [h as `0x${string}`] }).catch(() => null)) as readonly [number, string, bigint, bigint, bigint] | null;
    const deed = e?.[1];
    if (!deed || /^0x0+$/.test(deed)) return null;
    const [o, bal] = await Promise.all([
      cl.readContract({ address: deed as `0x${string}`, abi: [OWNER], functionName: "owner" }).catch(() => null) as Promise<string | null>,
      cl.getBalance({ address: deed as `0x${string}` }).catch(() => 0n),
    ]);
    if (!o || getAddress(o) !== getAddress(owner) || bal === 0n) return null;
    return { h: h as `0x${string}`, deed, bal };
  }))).filter((x): x is NonNullable<typeof x> => !!x);
  if (!found.length) return [];
  const px = pxOf(await prices(f, [{ chainId: 1, address: NATIVE_TOKEN }]), 1, NATIVE_TOKEN)?.price ?? null;
  const usdc = usdcOf(1);
  return found.map((d) => {
    const eth = Number(formatEther(d.bal));
    return {
      kind: "claimable", protocol: "ENS old registrar deed", chainId: 1,
      what: `ENS deed ${d.deed} holds ${eth} ETH (name hash ${d.h.slice(0, 10)}…); releaseDeed returns all of it (exact)`,
      valueUsd: px ? Math.round(eth * px * 100) / 100 : null,
      claimTx: releaseDeedTx(d.h),
      action: "Sign one transaction to release the deed; the ETH lands in your wallet, then swap on SwapChan",
      confidence: "high",
      ...(usdc ? { link: swapUrl(1, NATIVE_TOKEN, 1, usdc, d.bal.toString()) } : {}),
      evidence: [
        { chainId: 1, address: OLD_REGISTRAR, call: "entries", args: [d.h], raw: d.deed },
        { chainId: 1, address: d.deed, call: "owner", args: [], raw: owner },
        { chainId: 1, address: d.deed, call: "eth_getBalance", args: [], raw: d.bal.toString() },
      ],
    } as NewFound;
  });
}
