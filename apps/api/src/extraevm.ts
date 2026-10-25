/**
 * Extra EVM chains SwapChan has no swap route for yet (zkSync Era, Gnosis, Mantle, Celo, Blast, Berachain, Sonic,
 * Unichain, Fantom, Monad, Katana, HyperEVM). Free public RPCs only. For each chain: native balance, ERC-20
 * balances over the free LI.FI token list (curated list on Blast; none on Fantom), and known-spender approvals
 * on held tokens. Recovery: swapchan.com/recover builds the unsigned transfer back to the connected wallet; nothing is signed here.
 */
import {
  type Chain,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  formatUnits,
  getAddress,
  http,
  isAddress,
} from "viem";
import {
  berachain,
  blast,
  celo,
  fantom,
  gnosis,
  hyperEvm,
  katana,
  mantle,
  monad,
  sonic,
  unichain,
  zksync,
} from "viem/chains";
import { KNOWN_ONLY_NOTE, knownSpenderAllowances } from "./knownspenders.js";
import type { NewFound } from "./recover.js";
import { addChainParams, verifySweepTx } from "./sweepverify.js";
import { coinPrices } from "./utxochains.js";

type F = typeof fetch;
type X = {
  chain: Chain;
  rpc: string[];
  cg: string;
  lifi: boolean;
  tokens?: { a: string; sym: string; dec: number; cg?: string }[];
};
export const EXTRA_EVM: Record<string, X> = {
  zksync: { chain: zksync, rpc: ["https://mainnet.era.zksync.io"], cg: "ethereum", lifi: true },
  gnosis: {
    chain: gnosis,
    rpc: ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com"],
    cg: "xdai",
    lifi: true,
  },
  mantle: {
    chain: mantle,
    rpc: ["https://mantle-rpc.publicnode.com", "https://rpc.mantle.xyz"],
    cg: "mantle",
    lifi: true,
  },
  celo: {
    chain: celo,
    rpc: ["https://celo-rpc.publicnode.com", "https://forno.celo.org"],
    cg: "celo",
    lifi: true,
  },
  blast: {
    chain: blast,
    rpc: ["https://blast-rpc.publicnode.com", "https://rpc.blast.io"],
    cg: "ethereum",
    lifi: false,
    tokens: [
      { a: "0x4300000000000000000000000000000000000003", sym: "USDB", dec: 18, cg: "usdb" },
      { a: "0x4300000000000000000000000000000000000004", sym: "WETH", dec: 18, cg: "ethereum" },
    ],
  },
  berachain: {
    chain: berachain,
    rpc: ["https://berachain-rpc.publicnode.com", "https://rpc.berachain.com"],
    cg: "berachain-bera",
    lifi: true,
  },
  sonic: {
    chain: sonic,
    rpc: ["https://sonic-rpc.publicnode.com", "https://rpc.soniclabs.com"],
    cg: "sonic-3",
    lifi: true,
  },
  unichain: {
    chain: unichain,
    rpc: ["https://unichain-rpc.publicnode.com", "https://mainnet.unichain.org"],
    cg: "ethereum",
    lifi: true,
  },
  fantom: { chain: fantom, rpc: ["https://rpcapi.fantom.network"], cg: "fantom", lifi: false },
  monad: { chain: monad, rpc: ["https://rpc.monad.xyz"], cg: "monad", lifi: true },
  katana: { chain: katana, rpc: ["https://rpc.katana.network"], cg: "ethereum", lifi: true },
  hyperevm: {
    chain: hyperEvm,
    rpc: ["https://rpc.hyperliquid.xyz/evm"],
    cg: "hyperliquid",
    lifi: true,
  },
};
export type ExtraEvm = keyof typeof EXTRA_EVM;

const client = (x: X) =>
  createPublicClient({
    chain: x.chain,
    transport: fallback(x.rpc.map((u) => http(u, { timeout: 5000, retryCount: 0 }))),
    batch: { multicall: false },
  });

type Tok = { address: string; symbol: string; decimals: number; priceUSD?: string };
const lifiCache = new Map<number, { at: number; t: Tok[] }>();
async function lifiTokens(f: F, chainId: number): Promise<Tok[]> {
  const c = lifiCache.get(chainId);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.t;
  const r = await f(`https://li.quest/v1/tokens?chains=${chainId}`, {
    signal: AbortSignal.timeout(5000),
  });
  const j = (await r.json()) as { tokens?: Record<string, Tok[]> };
  const t = (j.tokens?.[String(chainId)] ?? []).filter(
    (x) => isAddress(x.address) && Number(x.priceUSD ?? 0) > 0,
  );
  // keep the most valuable-per-unit/major tokens first; cap the multicall size
  const out = t.slice(0, 400);
  lifiCache.set(chainId, { at: Date.now(), t: out });
  return out;
}
const ZERO = "0x0000000000000000000000000000000000000000";

export async function extraEvmScan(
  f: F,
  owner: string,
): Promise<{ items: NewFound[]; notChecked: string[] }> {
  const own = getAddress(owner);
  const ks = Object.keys(EXTRA_EVM) as ExtraEvm[];
  const px = await coinPrices(f, [
    ...new Set(ks.map((k) => EXTRA_EVM[k]!.cg).concat("usdb")),
  ]).catch(() => ({}) as Record<string, number>);
  const items: NewFound[] = [],
    notChecked: string[] = [];
  await Promise.all(
    ks.map(async (k) => {
      const x = EXTRA_EVM[k] as X,
        id = x.chain.id,
        name = x.chain.name,
        c = client(x);
      let wei: bigint;
      try {
        wei = await c.getBalance({ address: own });
      } catch {
        notChecked.push(`${name}: no working public RPC (not checked)`);
        return;
      }
      const sym = x.chain.nativeCurrency.symbol;
      if (wei > 0n) {
        const amt = Number(formatUnits(wei, 18)),
          p = (px as Record<string, number>)[x.cg];
        items.push(
          found(k, x, own, { sym, amt, usd: p ? amt * p : null, raw: wei, call: "eth_getBalance" }),
        );
      }
      // tokens
      let toks: { a: string; sym: string; dec: number; p: number | null }[] = [];
      try {
        if (x.lifi)
          toks = (await lifiTokens(f, id))
            .filter((t) => t.address !== ZERO)
            .map((t) => ({
              a: t.address,
              sym: t.symbol,
              dec: t.decimals,
              p: Number(t.priceUSD) || null,
            }));
        else
          toks = (x.tokens ?? []).map((t) => ({
            a: t.a,
            sym: t.sym,
            dec: t.dec,
            p: t.cg ? ((px as Record<string, number>)[t.cg] ?? null) : null,
          }));
      } catch {
        notChecked.push(
          `${name}: token list unavailable, ERC-20 balances not checked (native was checked)`,
        );
      }
      if (!toks.length) {
        if (!x.lifi && !x.tokens)
          notChecked.push(
            `${name}: ERC-20 tokens not checked (no free token index); native balance checked`,
          );
        return;
      }
      let held: string[] = [];
      try {
        const res = await c.multicall({
          allowFailure: true,
          contracts: toks.map((t) => ({
            address: getAddress(t.a),
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [own],
          })) as never[],
        });
        res.forEach((r, i) => {
          const b = r.status === "success" ? (r.result as unknown as bigint) : 0n;
          if (b <= 0n || (toks[i]!.sym === sym && b === wei)) return; // Celo-style native-as-ERC20 duplicate
          const t = toks[i]!,
            amt = Number(formatUnits(b, t.dec)),
            usd = t.p ? amt * t.p : null;
          held.push(t.a);
          if (usd !== null && usd < 0.01) return; // dust / spam
          items.push(
            found(k, x, own, {
              sym: t.sym,
              amt,
              usd,
              raw: b,
              call: "balanceOf",
              token: getAddress(t.a),
            }),
          );
        });
      } catch {
        notChecked.push(`${name}: ERC-20 balances not checked (multicall failed)`);
      }
      if (held.length) {
        try {
          const al = await knownSpenderAllowances(c as never, id, own, held);
          for (const a of al) {
            const t = toks.find((q) => q.a.toLowerCase() === a.token.toLowerCase());
            items.push({
              kind: "lead",
              protocol: `${name} approvals`,
              chainId: id,
              what: `${t?.sym ?? a.token} on ${name}: open approval to ${a.name} (${a.spender}) — revoke if unused (${KNOWN_ONLY_NOTE})`,
              valueUsd: null,
              confidence: "high",
              action: `Revoke by signing approve(${a.spender}, 0) on token ${a.token}, chainId ${id}, in your own wallet: data ${encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(a.spender), 0n] })}`,
              evidence: [
                {
                  chainId: id,
                  address: a.token,
                  call: "allowance",
                  args: [own, a.spender],
                  raw: a.allowance.toString(),
                },
              ],
            } as unknown as NewFound);
          }
        } catch {
          notChecked.push(`${name}: approvals not checked`);
        }
      }
    }),
  );
  notChecked.push(
    "Extra EVM chains (zkSync, Gnosis, Mantle, Celo, Blast, Berachain, Sonic, Unichain, Fantom, Monad, Katana, HyperEVM): vault/lending positions not checked; approvals checked against known spenders only",
  );
  return { items, notChecked };
}

function found(
  k: string,
  x: X,
  own: string,
  b: { sym: string; amt: number; usd: number | null; raw: bigint; call: string; token?: string },
): NewFound {
  const n = x.chain.name;
  return {
    kind: "claimable",
    protocol: `${n} wallet`,
    chainId: x.chain.id,
    what: `${b.amt.toPrecision(6)} ${b.sym} at your address on ${n} (exact balance; USD estimate).`,
    valueUsd: b.usd === null ? null : Math.round(b.usd * 100) / 100,
    action: `Get it back: open the swapchan.com/recover step, connect this wallet and sign the ${b.sym} transfer back to it. The page adds ${n} (chainId ${x.chain.id}) to your wallet if needed and only lets you sign an EIP-155 transaction with that chainId that pays your own address.`,
    confidence: "high",
    sweep: { kind: "evm", coin: k, from: own, sym: b.sym, ...(b.token ? { token: b.token } : {}) },
    evidence: [
      {
        chainId: x.chain.id,
        address: b.token ?? own,
        call: b.call,
        args: b.token ? [own] : [],
        raw: b.raw.toString(),
      },
    ],
  } as unknown as NewFound;
}

/** Unsigned transfer of the full native balance (minus gas) or full token balance. EIP-1559 fields where the chain supports them. */
export async function evmSweep(f: F, k: string, from: string, to: string, token?: string) {
  const x = EXTRA_EVM[k];
  if (!x) throw new Error(`chain must be one of ${Object.keys(EXTRA_EVM).join(", ")}`);
  if (!isAddress(from) || !isAddress(to) || (token && !isAddress(token)))
    throw new Error("from, to and token must be 0x addresses");
  const c = client(x),
    fr = getAddress(from),
    tt = getAddress(to);
  const [nonce, gp] = await Promise.all([c.getTransactionCount({ address: fr }), c.getGasPrice()]);
  const gasPrice = (gp * 13n) / 10n;
  let tx: Record<string, string | number>;
  if (token) {
    const bal = await c.readContract({
      address: getAddress(token),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [fr],
    });
    if (bal === 0n) throw new Error("token balance is zero");
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [tt, bal] });
    const gas =
      ((await c.estimateGas({ account: fr, to: getAddress(token), data }).catch(() => 100000n)) *
        13n) /
      10n;
    tx = {
      from: fr,
      to: getAddress(token),
      value: "0",
      data,
      gas: gas.toString(),
      gasPrice: gasPrice.toString(),
      nonce,
      chainId: x.chain.id,
      type: "legacy",
    };
  } else {
    const bal = await c.getBalance({ address: fr });
    const gas = await c.estimateGas({ account: fr, to: tt, value: 1n }).catch(() => 21000n);
    const g = k === "zksync" || k === "mantle" ? (gas * 15n) / 10n : gas;
    const value = bal - g * gasPrice;
    if (value <= 0n) throw new Error("balance does not cover gas");
    tx = {
      from: fr,
      to: tt,
      value: value.toString(),
      gas: g.toString(),
      gasPrice: gasPrice.toString(),
      nonce,
      chainId: x.chain.id,
      type: "legacy",
    };
  }
  const addChain = addChainParams(
    x.chain.id,
    x.chain.name,
    x.chain.nativeCurrency,
    x.rpc,
    x.chain.blockExplorers?.default.url,
  );
  return {
    chain: k,
    chainId: x.chain.id,
    tx,
    addChain,
    verified: verifySweepTx(tx, fr, x.chain.id, token),
    signing: `Sign this EIP-155 transaction (chainId ${x.chain.id}, ${x.chain.name}) in your own wallet; add the network if needed. Never paste a seed or private key into a website.`,
    note: "Gas is an estimate from the public RPC; your wallet may re-estimate it before signing.",
  };
}
