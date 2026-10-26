/**
 * LegacyETH registry, PR 2 families: ICO/presale refunds and burn-a-token-for-ETH redemptions.
 *
 * Refund families (one pinned claim selector each, no arguments):
 *   refund-claim      claimRefund()   OpenZeppelin RefundableCrowdsale; the ETH sits in a RefundVault (vault())
 *   refund-crowdsale  refund()        crowdsale holds the ETH itself
 *   presale-pool      withdrawAll()   presale pool contribution withdrawal
 *   presale-withdraw  withdraw()      presale pool contribution withdrawal
 * The amount owed is read on-chain from a per-contract view (only views in REFUND_VIEWS are ever called);
 * for vault crowdsales the view is read on the vault and the crowdsale's vault() must still return that vault.
 *
 * Burn-token family: each contract is pinned in BURN_SPECS (token, contract to call, claim, rate read, payer).
 * Two-step redemptions (approve, then burn/redeem) build only the next step, like The DAO refund:
 * step 1 is approve(exact claim contract, exact token balance), never unlimited; step 2 is the claim.
 */
import { formatUnits, maxUint256, parseAbiItem } from "viem";
import { btSelector, encodeFunctionData } from "../blocktools.js";
import type { Evidence } from "../recover.js";
import type { RegistryEntry } from "./registry.js";

export const REFUND_CLAIM: Record<string, string> = {
  "refund-claim": "claimRefund()",
  "refund-crowdsale": "refund()",
  "presale-pool": "withdrawAll()",
  "presale-withdraw": "withdraw()",
};
/** The only per-address views the refund families may read (all `view returns (uint256)`). */
export const REFUND_VIEWS = new Set([
  "deposited(address)",
  "saleBalanceOf(address)",
  "weiBalances(address)",
  "balances(address)",
  "EtherBalanceOf(address)",
  "deposits(address)",
  "getAvailableRefund(address)",
  "contributions(address)",
  "getAll(address)",
  "ETHContributed(address)",
]);

export interface BurnSpec {
  /** token the user holds (and, for two-step, approves) */
  token: `0x${string}`;
  /** contract the claim is sent to */
  claimTo: `0x${string}`;
  claim: "burn()" | "redeemTokens(uint256)" | "sellTokens(uint256)" | "redeem(uint256)";
  /** approve(claimTo, exact balance) first */
  approve: boolean;
  /** contract that pays the ETH (its balance must cover the claim) */
  payer: `0x${string}`;
  /** on-chain rate read and how the ETH owed follows from the token balance */
  rate?: {
    on: `0x${string}`;
    fn: "weiPerNanoDGD" | "exchangeRate" | "getPrice";
    op: "mul" | "div";
  };
  claimName: string;
}
/** Pinned per contract (keyed by registry key); the data file can only switch an entry on, not change these. */
export const BURN_SPECS: Record<string, BurnSpec> = {
  digixdao: {
    token: "0xe0b7927c4af23765cb51314a0e0521a9645f0e2a",
    claimTo: "0x23Ea10CC1e6EBdB499D24E45369A35f43627062f",
    claim: "burn()",
    approve: true,
    payer: "0x23Ea10CC1e6EBdB499D24E45369A35f43627062f",
    rate: { on: "0x23Ea10CC1e6EBdB499D24E45369A35f43627062f", fn: "weiPerNanoDGD", op: "mul" },
    claimName: "DigixDAO Acid refund contract",
  },
  delphi_redemption: {
    token: "0x02b9806a64cb05f02aa8dcc1c178b88159a61304",
    claimTo: "0x899f9a0440face1397a1ee1e3f6bf3580a6633d1",
    claim: "redeemTokens(uint256)",
    approve: true,
    payer: "0x899f9a0440face1397a1ee1e3f6bf3580a6633d1",
    rate: { on: "0x899f9a0440face1397a1ee1e3f6bf3580a6633d1", fn: "exchangeRate", op: "div" },
    claimName: "Delphi RedemptionContract",
  },
  quantfury_qdt: {
    token: "0xd18475521245a127a933a4fcaf99e8c45a416f7e",
    claimTo: "0xd18475521245a127a933a4fcaf99e8c45a416f7e",
    claim: "sellTokens(uint256)",
    approve: false,
    payer: "0xd18475521245a127a933a4fcaf99e8c45a416f7e",
    rate: { on: "0xd18475521245a127a933a4fcaf99e8c45a416f7e", fn: "getPrice", op: "mul" },
    claimName: "Quantfury QDT",
  },
  aave_v1: {
    // aETH redeems 1:1; Aave v1 LendingPoolCore pays the ETH
    token: "0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04",
    claimTo: "0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04",
    claim: "redeem(uint256)",
    approve: false,
    payer: "0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3",
    claimName: "Aave v1 aETH",
  },
};
export const BURN_APPROVE = "approve(address,uint256)";

/** Entry is a valid, confirmed PR-2 family row whose claim matches the code pin. */
export function validBurnRefund(e: RegistryEntry): boolean {
  if (e.status !== "confirmed") return false;
  if (e.family === "burn-token-for-eth") {
    const s = BURN_SPECS[e.key];
    const a = e.address.toLowerCase();
    return (
      !!s && e.claim === s.claim && (a === s.token.toLowerCase() || a === s.claimTo.toLowerCase())
    );
  }
  const c = REFUND_CLAIM[e.family];
  if (!c || e.claim !== c || !e.view || !REFUND_VIEWS.has(e.view)) return false;
  if (e.viewOn === "vault")
    return e.family === "refund-claim" && /^0x[0-9a-fA-F]{40}$/.test(e.vault ?? "");
  return e.viewOn === "self";
}
/** (contract, exact selector) pairs these families may build. */
export function burnRefundAllowlist(ents: RegistryEntry[]): Record<string, string[]> {
  const o: Record<string, string[]> = {};
  for (const e of ents) {
    const [to, sig] =
      e.family === "burn-token-for-eth"
        ? [BURN_SPECS[e.key]!.claimTo, BURN_SPECS[e.key]!.claim]
        : [e.address, REFUND_CLAIM[e.family]!];
    const k = to.toLowerCase();
    o[k] = [...new Set([...(o[k] ?? []), btSelector(sig)])];
  }
  return o;
}
/** token -> the only spender an approval may name (exact amount checked where it is built and verified). */
export function burnApprovals(ents: RegistryEntry[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const e of ents) {
    const s = e.family === "burn-token-for-eth" ? BURN_SPECS[e.key] : undefined;
    if (s?.approve) o[s.token.toLowerCase()] = s.claimTo.toLowerCase();
  }
  return o;
}
/** Approval check: exact token, exact spender, 0 < amount < unlimited, zero value. */
export function verifyApproval(
  approvals: Record<string, string>,
  tx: { to: string; data: string; value: string },
): boolean {
  const d = tx.data.toLowerCase();
  if (!d.startsWith(btSelector(BURN_APPROVE)) || d.length !== 10 + 128) return false;
  const spender = `0x${d.slice(10 + 24, 10 + 64)}`;
  const amt = BigInt(`0x${d.slice(10 + 64)}`);
  return (
    approvals[tx.to.toLowerCase()] === spender &&
    amt > 0n &&
    amt < maxUint256 / 2n &&
    BigInt(tx.value) === 0n
  );
}

/** ETH owed for a token balance, from the on-chain rate. */
export function burnOwed(s: BurnSpec, bal: bigint, rate: bigint | null): bigint | null {
  if (!s.rate) return bal;
  if (rate === null || rate === 0n) return null;
  return s.rate.op === "mul" ? bal * rate : bal / rate;
}

const V = (sig: string) => parseAbiItem(`function ${sig} view returns (uint256)`);
const ABI = {
  vault: parseAbiItem("function vault() view returns (address)"),
  bal: parseAbiItem("function balanceOf(address) view returns (uint256)"),
  allowance: parseAbiItem("function allowance(address,address) view returns (uint256)"),
  approve: parseAbiItem("function approve(address,uint256) returns (bool)"),
  burn: parseAbiItem("function burn()"),
  redeemTokens: parseAbiItem("function redeemTokens(uint256)"),
  sellTokens: parseAbiItem("function sellTokens(uint256)"),
  redeem: parseAbiItem("function redeem(uint256)"),
};

export interface BRHit {
  entry: RegistryEntry;
  owedWei: bigint;
  heldWei: bigint | null;
  simOk: boolean;
  claimable: boolean;
  /** 1 = approval is the next step, 2 = the claim (single-step claims are 2 of 2 implicitly) */
  step?: 1 | 2 | undefined;
  tx?: { chainId: 1; to: string; data: `0x${string}`; value: "0"; description: string };
  evidence: Evidence[];
}
type Res = { status: string; result?: unknown };
type Client = {
  multicall: (a: never) => Promise<unknown[]>;
  getBalance: (a: { address: `0x${string}`; blockNumber: bigint }) => Promise<bigint>;
  call: (a: {
    account: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    blockNumber: bigint;
  }) => Promise<unknown>;
  request?: (a: never) => Promise<unknown>;
};

/** eth_simulateV1 of [approve, claim] from the owner; true only if both succeed. Fails closed. */
async function simTwoStep(
  c: Client,
  owner: `0x${string}`,
  calls: { to: string; data: string }[],
  block: bigint,
): Promise<boolean> {
  if (!c.request) return false;
  try {
    const r = (await c.request({
      method: "eth_simulateV1",
      params: [
        {
          blockStateCalls: [{ calls: calls.map((x) => ({ from: owner, to: x.to, data: x.data })) }],
          validation: false,
        },
        `0x${block.toString(16)}`,
      ],
    } as never)) as { calls: { status: string }[] }[];
    const cs = r?.[0]?.calls ?? [];
    return cs.length === calls.length && cs.every((x) => x.status === "0x1");
  } catch {
    return false;
  }
}

export async function scanBurnRefund(
  c: Client,
  owner: `0x${string}`,
  block: bigint,
  ents: RegistryEntry[],
): Promise<{ hits: BRHit[]; failed: string[] }> {
  const at = { blockNumber: block };
  const ev = (address: string, call: string, args: string[], raw: unknown): Evidence => ({
    chainId: 1,
    address,
    call,
    abi: `function ${call} view returns (${call === "vault()" ? "address" : "uint256"})`,
    args,
    raw: String(raw),
    block: block.toString(),
  });
  const refunds = ents.filter((e) => e.family !== "burn-token-for-eth");
  const burns = ents.filter((e) => e.family === "burn-token-for-eth");
  type Q = { e: RegistryEntry; what: string; address: string; call: string; args: string[] };
  const qs: Q[] = [];
  const cs: unknown[] = [];
  const add = (q: Q, abi: unknown, functionName: string, args: unknown[]) => {
    qs.push(q);
    cs.push({ address: q.address, abi: [abi], functionName, args });
  };
  for (const e of refunds) {
    const tgt = e.viewOn === "vault" ? e.vault! : e.address;
    const fn = e.view!.split("(")[0]!;
    add({ e, what: "owed", address: tgt, call: e.view!, args: [owner] }, V(e.view!), fn, [owner]);
    if (e.viewOn === "vault")
      add(
        { e, what: "vault", address: e.address, call: "vault()", args: [] },
        ABI.vault,
        "vault",
        [],
      );
  }
  for (const e of burns) {
    const s = BURN_SPECS[e.key]!;
    add(
      { e, what: "bal", address: s.token, call: "balanceOf(address)", args: [owner] },
      ABI.bal,
      "balanceOf",
      [owner],
    );
    if (s.rate)
      add(
        { e, what: "rate", address: s.rate.on, call: `${s.rate.fn}()`, args: [] },
        V(`${s.rate.fn}()`),
        s.rate.fn,
        [],
      );
    if (s.approve)
      add(
        {
          e,
          what: "allow",
          address: s.token,
          call: "allowance(address,address)",
          args: [owner, s.claimTo],
        },
        ABI.allowance,
        "allowance",
        [owner, s.claimTo],
      );
  }
  const failed = new Set<string>();
  const got = new Map<RegistryEntry, Record<string, { v: unknown; q: Q }>>();
  if (qs.length) {
    const rs = (await c.multicall({ allowFailure: true, ...at, contracts: cs } as never)) as Res[];
    qs.forEach((q, i) => {
      const r = rs[i];
      const ok =
        r?.status === "success" &&
        (q.what === "vault" ? typeof r.result === "string" : typeof r.result === "bigint");
      if (!ok) return void failed.add(q.e.name);
      const m = got.get(q.e) ?? {};
      m[q.what] = { v: r!.result, q };
      got.set(q.e, m);
    });
  }
  const todo: {
    e: RegistryEntry;
    owed: bigint;
    payer: string;
    to: string;
    data: `0x${string}`;
    step?: 1 | 2 | undefined;
    twoStepSim?: { to: string; data: string }[] | undefined;
    desc: string;
    evidence: Evidence[];
  }[] = [];
  for (const [e, m] of got) {
    if (failed.has(e.name)) continue;
    const evidence = Object.values(m).map(({ v, q }) => ev(q.address, q.call, q.args, v));
    if (e.family !== "burn-token-for-eth") {
      if (e.viewOn === "vault" && String(m.vault!.v).toLowerCase() !== e.vault!.toLowerCase()) {
        failed.add(e.name); // vault moved: the pinned read no longer describes this crowdsale
        continue;
      }
      const owed = m.owed!.v as bigint;
      if (owed === 0n) continue;
      const sig = REFUND_CLAIM[e.family]!;
      todo.push({
        e,
        owed,
        payer: e.viewOn === "vault" ? e.vault! : e.address,
        to: e.address,
        data: btSelector(sig) as `0x${string}`,
        desc: `${sig}: refund ${formatUnits(owed, 18)} ETH from ${e.name}`,
        evidence,
      });
      continue;
    }
    const s = BURN_SPECS[e.key]!;
    const bal = m.bal!.v as bigint;
    if (bal === 0n) continue;
    const owed = burnOwed(s, bal, s.rate ? (m.rate!.v as bigint) : null);
    if (owed === null) {
      failed.add(e.name);
      continue;
    }
    if (owed === 0n) continue;
    const claimData = (
      s.claim === "burn()"
        ? encodeFunctionData({ abi: [ABI.burn], functionName: "burn" })
        : encodeFunctionData({
            abi: [ABI[s.claim.split("(")[0] as "redeemTokens" | "sellTokens" | "redeem"]],
            functionName: s.claim.split("(")[0] as never,
            args: [bal] as never,
          })
    ) as `0x${string}`;
    const needApprove = s.approve && (m.allow!.v as bigint) < bal;
    const approveData = needApprove
      ? (encodeFunctionData({
          abi: [ABI.approve],
          functionName: "approve",
          args: [s.claimTo, bal],
        }) as `0x${string}`)
      : undefined;
    todo.push({
      e,
      owed,
      payer: s.payer,
      to: needApprove ? s.token : s.claimTo,
      data: needApprove ? approveData! : claimData,
      step: s.approve ? (needApprove ? 1 : 2) : undefined,
      twoStepSim: needApprove
        ? [
            { to: s.token, data: approveData! },
            { to: s.claimTo, data: claimData },
          ]
        : undefined,
      desc: needApprove
        ? `Step 1 of 2: approve the ${s.claimName} to take exactly ${bal} base units of your tokens (then come back for ${s.claim})`
        : `${s.approve ? "Step 2 of 2: " : ""}${s.claim}: redeem your tokens for ${formatUnits(owed, 18)} ETH from the ${s.claimName}`,
      evidence,
    });
  }
  const hits = await Promise.all(
    todo.map(async (t) => {
      const [held, simOk] = await Promise.all([
        c.getBalance({ address: t.payer as `0x${string}`, ...at }).catch(() => null),
        t.twoStepSim
          ? simTwoStep(c, owner, t.twoStepSim, block)
          : c
              .call({ account: owner, to: t.to as `0x${string}`, data: t.data, ...at })
              .then(() => true)
              .catch(() => false),
      ]);
      const ok = t.owed > 0n && simOk && held !== null && held >= t.owed;
      const h: BRHit = {
        entry: t.e,
        owedWei: t.owed,
        heldWei: held,
        simOk,
        claimable: ok,
        step: t.step,
        evidence: t.evidence,
      };
      if (ok) h.tx = { chainId: 1, to: t.to, data: t.data, value: "0", description: t.desc };
      return h;
    }),
  );
  return { hits, failed: [...failed] };
}
