import { getAddress, isAddress } from "viem";
import type { NewFound } from "./recover.js";
import { coinPrices } from "./utxochains.js";

type F = typeof fetch;
/** Ethereum forks that copied every ETH balance at the fork block (2016 ETC, 2022 ETHW/EtherFair). */
export const ETH_FORKS = {
  etc: { name: "Ethereum Classic", sym: "ETC", chainId: 61, cg: "ethereum-classic", fork: "DAO fork, block 1,920,000 (Jul 2016)", rpc: ["https://etc.etcdesktop.com", "https://geth-at.etc-network.info"] },
  ethw: { name: "EthereumPoW", sym: "ETHW", chainId: 10001, cg: "ethereum-pow-iou", fork: "Merge fork, block 15,537,394 (Sep 2022)", rpc: ["https://mainnet.ethereumpow.org"] },
  etf: { name: "EtherFair", sym: "ETF", chainId: 513100, cg: "ethereumfair", fork: "Merge fork, block 15,537,394 (Sep 2022)", rpc: ["https://rpc.etherfair.org"] },
} as const;
export type EthFork = keyof typeof ETH_FORKS;
export const FORK_SIGN_GUIDE = (k: EthFork) =>
  `Replay protection: sign only an EIP-155 transaction with chainId ${ETH_FORKS[k].chainId} (${ETH_FORKS[k].sym}); a transaction without a chainId could be replayed on other chains. Use a wallet that supports custom networks, add the network yourself, never type a seed into a website.`;

async function rpc<T>(f: F, k: EthFork, method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (const u of ETH_FORKS[k].rpc) {
    try {
      const r = await f(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5000) });
      const j = (await r.json()) as { result?: T; error?: unknown };
      if (j.result !== undefined) return j.result;
      last = j.error;
    } catch (e) { last = e; }
  }
  throw new Error(`${k} rpc unavailable (${String(last)})`);
}

export async function ethForkScan(f: F, owner: string): Promise<{ items: NewFound[]; notChecked: string[] }> {
  const ks = Object.keys(ETH_FORKS) as EthFork[];
  const px = await coinPrices(f, ks.map((k) => ETH_FORKS[k].cg));
  const items: NewFound[] = [], notChecked: string[] = [];
  await Promise.all(ks.map(async (k) => {
    const c = ETH_FORKS[k];
    try {
      const wei = BigInt(await rpc<string>(f, k, "eth_getBalance", [owner, "latest"]));
      if (wei === 0n) return;
      const amt = Number(wei) / 1e18, p = px[c.cg];
      items.push({
        kind: "claimable", protocol: `${c.name} (fork coins)`, chainId: c.chainId,
        what: `${amt} ${c.sym} at your address on ${c.name} — ${c.fork} (exact balance; USD estimate)`,
        valueUsd: p ? Math.round(amt * p * 100) / 100 : null,
        action: `Build the unsigned transfer with /onchain/fork-sweep?chain=${k}&from=<this address>&to=<your ${c.sym} destination>, then sign it in your wallet on chainId ${c.chainId}. ${FORK_SIGN_GUIDE(k)}`,
        confidence: "high",
        evidence: [{ chainId: c.chainId, address: owner, call: "eth_getBalance", args: [], raw: wei.toString() }],
      } as NewFound);
    } catch { notChecked.push(`${c.name}: no working public RPC (not checked)`); }
  }));
  return { items, notChecked };
}

/** Unsigned EIP-155 legacy transfer of the whole balance minus 21000 x gasPrice. */
export async function forkSweep(f: F, k: EthFork, from: string, to: string) {
  if (!ETH_FORKS[k]) throw new Error("unknown fork chain");
  if (!isAddress(from) || !isAddress(to)) throw new Error("from and to must be 0x addresses");
  const [bal, gp, nonce] = await Promise.all([
    rpc<string>(f, k, "eth_getBalance", [from, "latest"]),
    rpc<string>(f, k, "eth_gasPrice", []),
    rpc<string>(f, k, "eth_getTransactionCount", [from, "latest"]),
  ]);
  const gasPrice = (BigInt(gp) * 12n) / 10n, value = BigInt(bal) - 21000n * gasPrice;
  if (value <= 0n) throw new Error("balance does not cover gas");
  return {
    chain: k, chainId: ETH_FORKS[k].chainId,
    tx: { from: getAddress(from), to: getAddress(to), value: value.toString(), gas: "21000", gasPrice: gasPrice.toString(), nonce: BigInt(nonce).toString(), chainId: ETH_FORKS[k].chainId, type: "legacy" },
    signing: FORK_SIGN_GUIDE(k),
  };
}
