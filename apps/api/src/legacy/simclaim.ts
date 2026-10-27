/**
 * LegacyETH registry, PR 5: "sim-claim" family. These contracts pay a fixed no-argument claim (refund,
 * presale-pool withdrawAll, dividend withdraw) but have no public view that returns the ETH owed.
 * The amount shown is therefore taken from the claim itself: one eth_simulateV1 of the pinned claim from
 * the owner at the pinned block, with traceTransfers, summing only native ETH sent from that contract to the
 * owner. Evidence keeps the simulated call and its traced payout.
 *
 * Fails closed: no eth_simulateV1, an RPC error, a reverted call, a length mismatch, or any ERC-20 Transfer
 * out of the owner's address in the same call means that contract is "not checked" (never a zero).
 * Claim selector and contract are pinned here per registry key; the data file can only switch a row on.
 */
import { formatUnits } from "viem";
import { btSelector } from "../blocktools.js";
import type { Evidence } from "../recover.js";
import type { RegistryEntry } from "./registry.js";

export type SimKind = "refund" | "pool" | "dividends" | "rewards" | "timelock";
export interface SimSpec {
  address: string;
  claim: string;
  kind: SimKind;
}
/** Confirmed at block 26280699 (one real holder each: the simulated claim paid that holder ETH and moved no
 *  tokens out of their address; an unrelated address got 0 or a revert). Pinned per registry key. */
export const SIM_SPECS: Record<string, SimSpec> = {
  hong: {
    address: "0x9fa8fa61a10ff892e4ebceb7f4e0fc684c2ce0a9",
    claim: "refundMyIcoInvestment()",
    kind: "refund",
  },
  foreground: {
    address: "0x943e99d9efd4b44d808f6c83373a9a2c1e15e0f8",
    claim: "claimRefund()",
    kind: "refund",
  },
  digipulse_token_sale: {
    address: "0x9aca6abfe63a5ae0dc6258cefb65207ec990aa4d",
    claim: "refundEther()",
    kind: "refund",
  },
  bayesin_bys_crowsale: {
    address: "0xe8b1b40f2d307bce891833f46eef1f69560e6926",
    claim: "safeWithdrawal()",
    kind: "refund",
  },
  contribution_pool: {
    address: "0xa812137eff2b368d0b2880a39b609fb60c426850",
    claim: "withdraw()",
    kind: "pool",
  },
  arbitrage_eth_staking: {
    address: "0x5eee354e36ac51e9d3f7283005cab0c55f423b23",
    claim: "withdrawAll()",
    kind: "pool",
  },
  bingo4beast_2: {
    address: "0x4fb7d68e0116f35ade131b6535b2db1027bf7650",
    claim: "withdraw()",
    kind: "pool",
  },
  p4rty_dao_vault: {
    address: "0x9465a32618a9172b3c14d82cecdca788de1ef878",
    claim: "withdraw()",
    kind: "pool",
  },
  ethpyramid: {
    address: "0x2fa0ac498d01632f959d3c18e38f4390b005e200",
    claim: "withdraw()",
    kind: "dividends",
  },
  treasure: {
    address: "0x25a06d4e1f804ce62cf11b091180a5c84980d93a",
    claim: "withdraw()",
    kind: "dividends",
  },
  nexgen: {
    address: "0xffd31e68bf7af89df862435a138615bd60abf574",
    claim: "withdraw()",
    kind: "dividends",
  },
  eks: {
    address: "0xe01e2a3ceafa8233021fc759e5a69863558326b6",
    claim: "withdraw()",
    kind: "dividends",
  },
  presalepool_48c1: {
    address: "0x48c128eafc3b937fb1f97889ad174ac02b4952cb",
    claim: "withdrawAll()",
    kind: "pool",
  },
  presalepool_ff2c: {
    address: "0xff2c689cb750f2a7d46e7471521189ced948f965",
    claim: "withdrawAll()",
    kind: "pool",
  },
  presalepool_d677: {
    address: "0xd6770aac65a48f5715889a4cdbf30a4faf73a073",
    claim: "withdrawAll()",
    kind: "pool",
  },
  presalepool_796d: {
    address: "0x796dbc51b37f2d92b0af1271fd9520c8efd1be61",
    claim: "withdrawAll()",
    kind: "pool",
  },
  presalepool_50c1: {
    address: "0x50c19ffdbda85d1a07c09f01e113a94923801d32",
    claim: "withdrawAll()",
    kind: "pool",
  },
  presalepool_6f40: {
    address: "0x6f40d96713b60d5083bc2493251907ca673de1b8",
    claim: "withdrawAll()",
    kind: "pool",
  },
  presalepool_b990: {
    address: "0xb9906cf500d5e61b9673115151104c990a804dcb",
    claim: "withdrawAll()",
    kind: "pool",
  },
  // PR 6, confirmed at block 26281225 (same test: three real holders paid native ETH, no token left
  // their address, an unrelated address reverted or got 0; claim read from the verified source).
  hourglassx: {
    address: "0x058a144951e062fc14f310057d2fd9ef0cf5095b",
    claim: "withdraw()",
    kind: "dividends",
  },
  singularx_fund: {
    address: "0x0286f920f893513c7ec9fe35ba0a4760229a243e",
    claim: "withdrawReward()",
    kind: "rewards",
  },
  qcotoken_ico: {
    address: "0x3a8a97123bccd826228e5eb4144b48cce169517b",
    claim: "requestRefund()",
    kind: "refund",
  },
  crowdsale_4363b5: {
    address: "0x4363b5d64f228c819dc706889b09a0dc76e22fb0",
    claim: "releaseEthers()",
    kind: "refund",
  },
  startmining_stm_sale: {
    address: "0xe8da050c3140183d4f5f01e048ac136e2da5253f",
    claim: "manualRefund()",
    kind: "refund",
  },
  hodl_ethereum: {
    address: "0x1bb28e79f2482df6bf60efc7a33365703bcf1536",
    claim: "party()",
    kind: "timelock",
  },
};
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function validSimClaim(e: RegistryEntry): boolean {
  if (e.status !== "confirmed" || e.family !== "sim-claim") return false;
  const s = SIM_SPECS[e.key];
  return !!s && s.address === e.address.toLowerCase() && e.claim === s.claim;
}
export function simClaimAllowlist(ents: RegistryEntry[]): Record<string, string[]> {
  const o: Record<string, string[]> = {};
  for (const e of ents.filter(validSimClaim))
    o[SIM_SPECS[e.key]!.address] = [btSelector(SIM_SPECS[e.key]!.claim)];
  return o;
}
export function simLabel(e: RegistryEntry): string | undefined {
  const k = SIM_SPECS[e.key]?.kind;
  if (k === "dividends")
    return "Dividends only: withdraw() pays your ETH dividends; any tokens you still hold are not sold";
  if (k === "refund")
    return `Refund: ${SIM_SPECS[e.key]!.claim} returns your recorded contribution and cancels it in the contract`;
  if (k === "pool")
    return `Pool withdrawal: ${SIM_SPECS[e.key]!.claim} pays your whole recorded share`;
  if (k === "rewards")
    return `Rewards only: ${SIM_SPECS[e.key]!.claim} pays your accrued ETH rewards; your tokens stay where they are`;
  if (k === "timelock")
    return `Time-lock release: ${SIM_SPECS[e.key]!.claim} returns your whole locked deposit`;
  return undefined;
}

interface Log {
  address: string;
  topics: string[];
  data: string;
}
/** Native ETH the contract sends the owner in one traced call; null when the call is not a clean ETH payout. */
export function tracedPayout(
  call: { status?: string; logs?: Log[] } | undefined,
  contract: string,
  owner: string,
): bigint | null {
  if (!call || call.status !== "0x1") return null;
  const word = (a: string) => `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const c = word(contract);
  const o = word(owner);
  let paid = 0n;
  for (const l of call.logs ?? []) {
    if (l.topics?.[0]?.toLowerCase() !== TRANSFER || l.topics.length < 3) continue;
    const from = l.topics[1]!.toLowerCase();
    const to = l.topics[2]!.toLowerCase();
    const v = l.data && l.data !== "0x" ? BigInt(l.data) : 0n;
    if (l.address.toLowerCase() === NATIVE) {
      if (from === c && to === o) paid += v;
    } else if (from === o) return null; // a token leaves the owner: not a plain ETH claim
    // Note: this guard only sees Transfer-topic events (ERC-20/721 Transfer and traced native
    // transfers); token movements that emit no Transfer log are not detected here.
  }
  return paid;
}

/** Max simultaneous eth_simulateV1 requests per scan. */
export const SIM_CONCURRENCY = 5;

export interface SimHit {
  entry: RegistryEntry;
  owedWei: bigint;
  heldWei: bigint | null;
  simOk: boolean;
  claimable: boolean;
  tx?: { chainId: 1; to: string; data: `0x${string}`; value: "0"; description: string };
  evidence: Evidence[];
}
type Client = {
  getBalance: (a: { address: `0x${string}`; blockNumber: bigint }) => Promise<bigint>;
  request?: (a: never) => Promise<unknown>;
};
export async function scanSimClaim(
  c: Client,
  owner: `0x${string}`,
  block: bigint,
  ents: RegistryEntry[],
): Promise<{ hits: SimHit[]; failed: string[] }> {
  const es = ents.filter(validSimClaim);
  if (!es.length) return { hits: [], failed: [] };
  const calls = es.map((e) => ({
    from: owner,
    to: SIM_SPECS[e.key]!.address,
    data: btSelector(SIM_SPECS[e.key]!.claim),
  }));
  // Each contract's claim is its own eth_simulateV1 request with exactly one blockStateCall,
  // so every simulation starts from the pinned block state. (blockStateCalls inside one
  // request are successive blocks: state and timestamp would carry over between claims.)
  // Bounded concurrency; the caller's per-source time limit still applies. Fail closed:
  // any RPC error or odd result means "not checked".
  type SimBlock = { calls?: { status?: string; logs?: Log[] }[] };
  const simOne = (x: (typeof calls)[number]): Promise<SimBlock[] | null> =>
    (c.request
      ? (c.request({
          method: "eth_simulateV1",
          params: [
            { blockStateCalls: [{ calls: [x] }], traceTransfers: true, validation: false },
            `0x${block.toString(16)}`,
          ],
        } as never) as Promise<SimBlock[]>)
      : Promise.reject(new Error("no eth_simulateV1"))
    ).catch(() => null);
  const rs: (SimBlock[] | null)[] = new Array(calls.length).fill(null);
  for (let i = 0; i < calls.length; i += SIM_CONCURRENCY) {
    const part = await Promise.all(calls.slice(i, i + SIM_CONCURRENCY).map(simOne));
    part.forEach((r, j) => {
      rs[i + j] = r;
    });
  }
  const failed: string[] = [];
  const hits: SimHit[] = [];
  const paid: { e: RegistryEntry; amt: bigint }[] = [];
  es.forEach((e, i) => {
    const res = rs[i];
    const r = Array.isArray(res) && res.length === 1 ? res[0]?.calls : undefined;
    if (!r || r.length !== 1) return void failed.push(e.name);
    const call = r[0]!;
    // a revert simply means nothing is owed to this owner; any other oddity is "not checked"
    if (call.status === "0x0") return;
    const amt = tracedPayout(call, SIM_SPECS[e.key]!.address, owner);
    if (amt === null) return void failed.push(e.name);
    if (amt > 0n) paid.push({ e, amt });
  });
  for (const { e, amt } of paid) {
    const s = SIM_SPECS[e.key]!;
    const held = await c
      .getBalance({ address: s.address as `0x${string}`, blockNumber: block })
      .catch(() => null);
    const ok = held !== null && held >= amt;
    const data = btSelector(s.claim) as `0x${string}`;
    const h: SimHit = {
      entry: e,
      owedWei: amt,
      heldWei: held,
      simOk: true,
      claimable: ok,
      evidence: [
        {
          chainId: 1,
          address: e.address,
          call: s.claim,
          abi: `eth_simulateV1 of ${s.claim} from the owner (traceTransfers): native ETH from the contract to the owner`,
          args: [owner],
          raw: amt.toString(),
          block: block.toString(),
        },
      ],
    };
    if (ok)
      h.tx = {
        chainId: 1,
        to: e.address,
        data,
        value: "0",
        description: `${s.claim}: withdraw ${formatUnits(amt, 18)} ETH from ${e.name} (amount from the simulated claim)`,
      };
    hits.push(h);
  }
  return { hits, failed };
}
