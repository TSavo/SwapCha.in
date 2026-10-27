/**
 * LegacyETH registry: data-driven scan of the legacy Ethereum contracts listed at legacyeth.com/contracts
 * (addresses from LegacyETH's CC0 open dataset). Each entry has a family; one family module covers every
 * contract of that shape. Only entries with status "confirmed" are scanned: their claim function was
 * confirmed by a real holder's view read > 0 plus an eth_call of the claim from that holder (and, for DEXes,
 * an overdraw that reverts). Everything else is reported as "not checked yet", never as a silent zero.
 *
 * PR 3 families: weth-wrapper (balanceOf(owner) + withdraw(uint256), old ETH wrappers that pay native ETH),
 * ether-balances (balances(owner) + withdrawEther(uint256)), presale-safe-withdrawal (balanceOf(owner) +
 * safeWithdrawal()) and hourglass P3D clones (myDividends(true) read as the owner + withdraw(); dividends
 * only, the clone tokens are left alone). PoWH3D itself stays on its dedicated code in intel.ts.
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
import { scanSimClaim, simClaimAllowlist, simLabel, validSimClaim } from "./simclaim.js";

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
  "weth-wrapper": "withdraw(uint256)",
  "ether-balances": "withdrawEther(uint256)",
  "presale-safe-withdrawal": "safeWithdrawal()",
  hourglass: "withdraw()",
  // Ethfinex WrapperLockEth: after the deposit lock expired the signature fields are unused (passed as zero)
  "ethfinex-wrapper": "withdraw(uint256,uint8,bytes32,bytes32,uint256)",
};
/** Single-read families: the per-address view (on the contract itself) that returns the ETH owed. */
export const FAMILY_VIEW: Record<string, { fn: string; sig: string; zeroFirst?: boolean }> = {
  "etherdelta-dex": { fn: "tokens", sig: "tokens(address,address)", zeroFirst: true },
  "weth-wrapper": { fn: "balanceOf", sig: "balanceOf(address)" },
  "ether-balances": { fn: "balances", sig: "balances(address)" },
  "presale-safe-withdrawal": { fn: "balanceOf", sig: "balanceOf(address)" },
  "ethfinex-wrapper": { fn: "balanceOf", sig: "balanceOf(address)" },
};
/** Claims that take the owed amount as their single uint256 argument. */
const AMOUNT_ARG = new Set([
  "withdraw(uint256)",
  "withdrawEther(uint256)",
  "withdraw(uint256,uint8,bytes32,bytes32,uint256)",
]);
export const SCANNED_FAMILIES = new Set<Family>(Object.keys(FAMILY_CLAIM));
/** Confirmed rows whose claim matches the family's pinned selector; any mismatch is refused (not scanned). */
const validPr1 = (e: RegistryEntry) =>
  e.status === "confirmed" && SCANNED_FAMILIES.has(e.family) && e.claim === FAMILY_CLAIM[e.family];
export const validEntry = (e: RegistryEntry) =>
  validPr1(e) || validBurnRefund(e) || validSimClaim(e);
export const scanned = () => REGISTRY.filter(validEntry);
export const refused = () => REGISTRY.filter((e) => e.status === "confirmed" && !validEntry(e));

/** (contract, exact selector) pairs for confirmed entries; merged into intel.ts CLAIM_ALLOWLIST. */
export const REGISTRY_ALLOWLIST: Record<string, string[]> = {
  ...Object.fromEntries(
    scanned()
      .filter(validPr1)
      .map((e) => [e.address.toLowerCase(), [btSelector(FAMILY_CLAIM[e.family]!)]]),
  ),
  ...burnRefundAllowlist(scanned().filter((e) => !validPr1(e) && !validSimClaim(e))),
  ...simClaimAllowlist(scanned()),
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
  if (e.family === "pull-payment")
    l.push(
      "Pull payment: withdraw() pays your whole pending balance in this market (sale proceeds or returned bids)",
    );
  if (e.family === "hourglass")
    l.push(
      "Dividends only: withdraw() pays your ETH dividends; any clone tokens you still hold are not sold",
    );
  const sl = simLabel(e);
  if (sl) l.push(sl);
  if (e.family === "ethfinex-wrapper")
    l.push(
      "Ethfinex wrapper: burns your ETHW wrapper tokens 1:1 for ETH (deposit lock long expired)",
    );
  if (held !== null && held < owed)
    l.push(
      `Underfunded: the contract holds ${formatUnits(held, 18)} ETH but owes you ${formatUnits(owed, 18)} ETH`,
    );
  return l;
}

const A = {
  tokens: parseAbiItem("function tokens(address,address) view returns (uint256)"),
  balanceOf: parseAbiItem("function balanceOf(address) view returns (uint256)"),
  balances: parseAbiItem("function balances(address) view returns (uint256)"),
  withdrawEther: parseAbiItem("function withdrawEther(uint256)"),
  safeWithdrawal: parseAbiItem("function safeWithdrawal()"),
  pid: parseAbiItem("function pIDxAddr_(address) view returns (uint256)"),
  vaults: parseAbiItem("function getPlayerVaults(uint256) view returns (uint256,uint256,uint256)"),
  withdraw0: parseAbiItem("function withdraw()"),
  withdraw1: parseAbiItem("function withdraw(uint256)"),
  withdrawLock: parseAbiItem("function withdraw(uint256,uint8,bytes32,bytes32,uint256)"),
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
  // single-view families, EtherDelta-style DEXes first
  const dex = [
    ...ents.filter((e) => e.family === "etherdelta-dex"),
    ...ents.filter((e) => e.family !== "etherdelta-dex" && FAMILY_VIEW[e.family]),
  ];
  const fomo = ents.filter((e) => e.family === "fomo3d");
  const hg = ents.filter((e) => e.family === "hourglass");
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
      ...dex.map((e) => {
        const v = FAMILY_VIEW[e.family]!;
        return {
          address: e.address as `0x${string}`,
          abi: [A[v.fn as "tokens" | "balanceOf" | "balances"]],
          functionName: v.fn,
          args: v.zeroFirst ? [ZERO, owner] : [owner],
        };
      }),
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
    if (r.status !== "success" || typeof r.result !== "bigint") return void failed.push(e.name);
    const v = FAMILY_VIEW[e.family]!;
    if (r.result > 0n)
      owed.set(e, {
        amt: r.result,
        evidence: [
          ev(
            e,
            v.sig,
            `function ${v.sig} view returns (uint256)`,
            v.zeroFirst ? [ZERO, owner] : [owner],
            r.result,
          ),
        ],
      });
  });
  // Hourglass clones: myDividends(true) reads msg.sender, so it is read as the owner in one eth_simulateV1
  // batch at the pinned block. No simulateV1, a failed call or an odd return: that clone is not checked.
  // withdraw() paying exactly myDividends(true) was confirmed per clone at confirmation time only (block 26280380);
  // the scan does not re-simulate withdraw(). The amount shown is myDividends(true) alone, never a token sell value.
  if (hg.length) {
    const data = btSelector("myDividends(bool)") + "1".padStart(64, "0");
    const rs = await (c.request
      ? (c.request({
          method: "eth_simulateV1",
          params: [
            {
              blockStateCalls: [{ calls: hg.map((e) => ({ from: owner, to: e.address, data })) }],
              validation: false,
            },
            `0x${block.toString(16)}`,
          ],
        } as never) as Promise<{ calls?: { status?: string; returnData?: string }[] }[]>)
      : Promise.reject(new Error("no eth_simulateV1"))
    )
      .then((r) => r?.[0]?.calls ?? [])
      .catch(() => [] as { status?: string; returnData?: string }[]);
    hg.forEach((e, i) => {
      const r = rs.length === hg.length ? rs[i] : undefined;
      const raw = r?.returnData ?? "";
      if (r?.status !== "0x1" || !/^0x[0-9a-fA-F]{64}$/.test(raw)) return void failed.push(e.name);
      const amt = BigInt(raw);
      if (amt > 0n)
        owed.set(e, {
          amt,
          evidence: [
            ev(
              e,
              "myDividends(bool)",
              "function myDividends(bool) view returns (uint256) (read as the owner)",
              ["true"],
              amt,
            ),
          ],
        });
    });
  }
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
      const sig = FAMILY_CLAIM[e.family]!;
      const data = (
        sig === "withdraw()"
          ? encodeFunctionData({ abi: [A.withdraw0], functionName: "withdraw" })
          : sig === "safeWithdrawal()"
            ? encodeFunctionData({ abi: [A.safeWithdrawal], functionName: "safeWithdrawal" })
            : sig === "withdrawEther(uint256)"
              ? encodeFunctionData({
                  abi: [A.withdrawEther],
                  functionName: "withdrawEther",
                  args: [amt],
                })
              : sig === "withdraw(uint256,uint8,bytes32,bytes32,uint256)"
                ? encodeFunctionData({
                    abi: [A.withdrawLock],
                    functionName: "withdraw",
                    args: [amt, 0, `0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`, 0n],
                  })
                : encodeFunctionData({ abi: [A.withdraw1], functionName: "withdraw", args: [amt] })
      ) as `0x${string}`;
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
          description: `${AMOUNT_ARG.has(sig) ? `${sig.split("(")[0]}(${amt})` : sig}: withdraw ${formatUnits(amt, 18)} ETH from ${e.name}`,
        };
      return h;
    }),
  );
  const br = await scanBurnRefund(
    c as never,
    owner,
    block,
    scanned().filter((e) => !validPr1(e) && !validSimClaim(e)),
  ).catch(() => ({
    hits: [],
    failed: scanned()
      .filter((e) => !validPr1(e) && !validSimClaim(e))
      .map((e) => e.name),
  }));
  const sc = await scanSimClaim(c as never, owner, block, scanned()).catch(() => ({
    hits: [],
    failed: scanned()
      .filter(validSimClaim)
      .map((e) => e.name),
  }));
  failed.push(...sc.failed);
  for (const b of sc.hits) hits.push({ ...b, labels: labels(b.entry, b.owedWei, b.heldWei) });
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
