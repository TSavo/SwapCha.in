/**
 * LegacyETH registry: data-driven scan of the legacy Ethereum contracts listed at legacyeth.com/contracts
 * (addresses from LegacyETH's CC0 open dataset). Each entry has a family; one family module covers every
 * contract of that shape. Only entries with status "confirmed" are scanned: their claim function was
 * confirmed by a real holder's view read > 0 plus an eth_call of the claim from that holder (and, for DEXes,
 * an overdraw that reverts). Everything else is reported as "not checked yet", never as a silent zero.
 *
 * Reads are batched through Multicall3 and pinned to one block; every read is kept as evidence. A claim is
 * offered only if the contract holds what is owed and an eth_call of the claim from the owner succeeds.
 * SwapChan only builds the unsigned transaction; the owner's wallet signs it.
 */
import { formatUnits, type PublicClient, parseAbiItem } from "viem";
import { btSelector, encodeFunctionData } from "../blocktools.js";
import type { Evidence } from "../recover.js";
import {
  burnApprovals,
  burnRefundAllowlist,
  scanBurnRefund,
  validBurnRefund,
} from "./burnrefund.js";
import REG from "./registry.json" with { type: "json" };

export type Family = "etherdelta-dex" | "fomo3d" | string;
export interface RegistryEntry {
  key: string;
  name: string;
  address: string;
  family: Family;
  listedEth: number | null;
  status: "confirmed" | "not-checked" | "covered-elsewhere";
  claim?: string;
  confirmedAtBlock?: number;
  eoaOnly?: boolean;
  ownerGated?: boolean;
  multiStep?: boolean;
  /** refund families: per-address view that returns the ETH owed (allowed set pinned in burnrefund.ts) */
  view?: string;
  viewOn?: "self" | "vault";
  vault?: string;
}
export const REGISTRY = (REG as { entries: RegistryEntry[] }).entries;
/** The only claim each family module will ever build; pinned in code, not taken from the data file. */
export const FAMILY_CLAIM: Record<string, string> = {
  "etherdelta-dex": "withdraw(uint256)",
  fomo3d: "withdraw()",
};
export const SCANNED_FAMILIES = new Set<Family>(Object.keys(FAMILY_CLAIM));
/** Confirmed rows whose claim matches the family's pinned selector; any mismatch is refused (not scanned). */
const validPr1 = (e: RegistryEntry) =>
  e.status === "confirmed" && SCANNED_FAMILIES.has(e.family) && e.claim === FAMILY_CLAIM[e.family];
export const validEntry = (e: RegistryEntry) => validPr1(e) || validBurnRefund(e);
export const scanned = () => REGISTRY.filter(validEntry);
export const refused = () => REGISTRY.filter((e) => e.status === "confirmed" && !validEntry(e));

/** (contract, exact selector) pairs for confirmed entries; merged into intel.ts CLAIM_ALLOWLIST. */
export const REGISTRY_ALLOWLIST: Record<string, string[]> = {
  ...Object.fromEntries(
    scanned()
      .filter(validPr1)
      .map((e) => [e.address.toLowerCase(), [btSelector(FAMILY_CLAIM[e.family]!)]]),
  ),
  ...burnRefundAllowlist(scanned().filter((e) => !validPr1(e))),
};
/** token -> the only spender a two-step approval may name (exact amount, never unlimited). */
export const REGISTRY_APPROVALS: Record<string, string> = burnApprovals(scanned());

/** Pure gating: claim only if something is owed, the contract can pay it, and the simulated claim succeeded. */
export function claimableNow(owed: bigint, held: bigint | null, simOk: boolean) {
  // fail closed: an unread balance is not proof the contract can pay
  return owed > 0n && simOk && held !== null && held >= owed;
}
/** Labels shown with every item. */
export function labels(e: RegistryEntry, owed: bigint, held: bigint | null): string[] {
  const l: string[] = [];
  if (e.eoaOnly)
    l.push(
      "EOA only: the contract rejects calls from smart-contract wallets (Safe, 4337); sign from the original key",
    );
  if (e.ownerGated) l.push("Owner action required: the contract owner must unlock claims first");
  if (e.multiStep)
    l.push("Two steps: approve the exact token amount to the redemption contract, then claim");
  if (held === null)
    l.push("Balance read failed: could not confirm the contract can pay, so no claim is offered");
  if (held !== null && held < owed)
    l.push(
      `Underfunded: the contract holds ${formatUnits(held, 18)} ETH but owes you ${formatUnits(owed, 18)} ETH`,
    );
  return l;
}

const A = {
  tokens: parseAbiItem("function tokens(address,address) view returns (uint256)"),
  pid: parseAbiItem("function pIDxAddr_(address) view returns (uint256)"),
  vaults: parseAbiItem("function getPlayerVaults(uint256) view returns (uint256,uint256,uint256)"),
  withdraw0: parseAbiItem("function withdraw()"),
  withdraw1: parseAbiItem("function withdraw(uint256)"),
};
const ZERO = "0x0000000000000000000000000000000000000000";

export interface RegistryHit {
  entry: RegistryEntry;
  owedWei: bigint;
  heldWei: bigint | null;
  simOk: boolean;
  claimable: boolean;
  /** two-step flows: 1 = the approval is next, 2 = the claim is next */
  step?: 1 | 2 | undefined;
  labels: string[];
  tx?: {
    chainId: 1;
    to: string;
    data: `0x${string}`;
    value: "0";
    description: string;
    approveMax?: bigint;
  };
  evidence: Evidence[];
}

type Client = Pick<PublicClient, "multicall" | "getBalance" | "call"> &
  Partial<Pick<PublicClient, "request">>;

export async function scanRegistry(
  c: Client,
  owner: `0x${string}`,
  block: bigint | undefined,
): Promise<{ hits: RegistryHit[]; notChecked: string[] }> {
  // never scan unpinned: reads at different blocks could disagree and evidence would not be reproducible
  if (block === undefined)
    return {
      hits: [],
      notChecked: [
        `LegacyETH registry: ${REGISTRY.length} listed contracts not checked (could not read the current block)`,
      ],
    };
  const at = { blockNumber: block };
  const ents = scanned().filter(validPr1);
  const dex = ents.filter((e) => e.family === "etherdelta-dex");
  const fomo = ents.filter((e) => e.family === "fomo3d");
  const ev = (
    e: RegistryEntry,
    call: string,
    abi: string,
    args: string[],
    raw: unknown,
  ): Evidence => ({
    chainId: 1,
    address: e.address,
    call,
    abi,
    args,
    raw: Array.isArray(raw) ? raw.map(String) : String(raw),
    block: block.toString(),
  });
  // one Multicall3 batch for every first-stage read
  const first = await c.multicall({
    allowFailure: true,
    ...at,
    contracts: [
      ...dex.map((e) => ({
        address: e.address as `0x${string}`,
        abi: [A.tokens],
        functionName: "tokens",
        args: [ZERO, owner],
      })),
      ...fomo.map((e) => ({
        address: e.address as `0x${string}`,
        abi: [A.pid],
        functionName: "pIDxAddr_",
        args: [owner],
      })),
    ] as never,
  });
  const failed: string[] = [];
  const owed = new Map<RegistryEntry, { amt: bigint; evidence: Evidence[] }>();
  dex.forEach((e, i) => {
    const r = first[i] as { status: string; result?: bigint };
    if (r.status !== "success") return void failed.push(e.name);
    if ((r.result ?? 0n) > 0n)
      owed.set(e, {
        amt: r.result!,
        evidence: [
          ev(
            e,
            "tokens(address,address)",
            "function tokens(address,address) view returns (uint256)",
            [ZERO, owner],
            r.result,
          ),
        ],
      });
  });
  const pids: { e: RegistryEntry; pid: bigint }[] = [];
  fomo.forEach((e, j) => {
    const r = first[dex.length + j] as { status: string; result?: bigint };
    if (r.status !== "success") return void failed.push(e.name);
    if ((r.result ?? 0n) > 0n) pids.push({ e, pid: r.result! });
  });
  if (pids.length) {
    const vs = await c.multicall({
      allowFailure: true,
      ...at,
      contracts: pids.map(({ e, pid }) => ({
        address: e.address as `0x${string}`,
        abi: [A.vaults],
        functionName: "getPlayerVaults",
        args: [pid],
      })) as never,
    });
    pids.forEach(({ e, pid }, k) => {
      const r = vs[k] as { status: string; result?: readonly bigint[] };
      if (r.status !== "success") return void failed.push(e.name);
      const tot = (r.result ?? []).reduce((a, b) => a + b, 0n);
      if (tot > 0n)
        owed.set(e, {
          amt: tot,
          evidence: [
            ev(
              e,
              "pIDxAddr_(address)",
              "function pIDxAddr_(address) view returns (uint256)",
              [owner],
              pid,
            ),
            ev(
              e,
              "getPlayerVaults(uint256)",
              "function getPlayerVaults(uint256) view returns (uint256,uint256,uint256)",
              [pid.toString()],
              r.result,
            ),
          ],
        });
    });
  }
  const hits = await Promise.all(
    [...owed].map(async ([e, { amt, evidence }]) => {
      const data =
        e.claim === "withdraw()"
          ? encodeFunctionData({ abi: [A.withdraw0], functionName: "withdraw" })
          : encodeFunctionData({ abi: [A.withdraw1], functionName: "withdraw", args: [amt] });
      const [held, simOk] = await Promise.all([
        c.getBalance({ address: e.address as `0x${string}`, ...at }).catch(() => null),
        c
          .call({ account: owner, to: e.address as `0x${string}`, data, ...at })
          .then(() => true)
          .catch(() => false),
      ]);
      const ok = claimableNow(amt, held, simOk);
      const h: RegistryHit = {
        entry: e,
        owedWei: amt,
        heldWei: held,
        simOk,
        claimable: ok,
        labels: labels(e, amt, held),
        evidence,
      };
      if (ok)
        h.tx = {
          chainId: 1,
          to: e.address,
          data,
          value: "0",
          description: `${e.claim === "withdraw()" ? "withdraw()" : `withdraw(${amt})`}: withdraw ${formatUnits(amt, 18)} ETH from ${e.name}`,
        };
      return h;
    }),
  );
  const br = await scanBurnRefund(
    c as never,
    owner,
    block,
    scanned().filter((e) => !validPr1(e)),
  ).catch(() => ({
    hits: [],
    failed: scanned()
      .filter((e) => !validPr1(e))
      .map((e) => e.name),
  }));
  failed.push(...br.failed);
  for (const b of br.hits) hits.push({ ...b, labels: labels(b.entry, b.owedWei, b.heldWei) });
  const notChecked: string[] = [];
  const noBal = hits.filter((h) => h.heldWei === null).map((h) => h.entry.name);
  if (noBal.length)
    notChecked.push(`LegacyETH registry: ${noBal.join(", ")}: not checked (balance read failed)`);
  if (failed.length)
    notChecked.push(`LegacyETH registry: ${failed.join(", ")}: not checked (read failed)`);
  const pending = REGISTRY.filter(
    (e) => e.status === "not-checked" || (e.status === "confirmed" && !validEntry(e)),
  );
  if (pending.length)
    notChecked.push(
      `LegacyETH registry: ${pending.length} of ${REGISTRY.length} listed contracts not checked yet (claim not confirmed; families: ${[...new Set(pending.map((e) => e.family))].join(", ")})`,
    );
  return { hits, notChecked };
}
