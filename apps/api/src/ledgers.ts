import { createHash } from "node:crypto";
import { btAddrValid, btDetect } from "./blocktools.js";
import { safeReason } from "./reasons.js";
import type { NewFound } from "./recover.js";
import { coinPrices } from "./utxochains.js";

type F = typeof fetch;
const sha256 = (d: Uint8Array) => createHash("sha256").update(d).digest();
const XRPL = [
  "https://xrplcluster.com",
  "https://s1.ripple.com:51234",
  "https://s2.ripple.com:51234",
];
const SIGNUM = [
  "https://europe.signum.network",
  "https://brazil.signum.network",
  "https://us-east.signum.network",
];

/** Classic XRP Ledger r-address with a valid checksum, via blocktools wasm (fails closed). blocktools also
 *  accepts X-addresses (XLS-5d, tag embedded); the scanners need the classic form, so r only. */
export const isXrpAddress = (a: string): boolean => /^r/.test(a) && btAddrValid("xrp", a);

/** Signum (ex-Burst) Reed-Solomon address S-XXXX-XXXX-XXXX-XXXXX or BURST-...; returns the S- form. */
export function signumAddress(a: string): string | null {
  const m =
    /^(?:S|BURST)-([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{5})$/i.exec(
      a.trim(),
    );
  return m ? `S-${m[1]!.toUpperCase()}` : null;
}

async function xrpl<T>(f: F, method: string, params: Record<string, unknown>): Promise<T> {
  let last: unknown;
  for (const u of XRPL) {
    try {
      const r = await f(u, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params: [params] }),
        signal: AbortSignal.timeout(5000),
      });
      const j = (await r.json()) as { result?: T & { status?: string; error?: string } };
      if (j.result && (j.result.status === "success" || j.result.error === "actNotFound"))
        return j.result;
      last = j.result?.error ?? r.status;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`XRPL unavailable (${String(last)})`);
}

/** XRP balance, locked reserve, and whether AccountDelete can release the reserve (exact drops; USD estimate). */
export async function xrpScan(
  f: F,
  account: string,
): Promise<{ items: NewFound[]; notChecked: string[] }> {
  try {
    const [info, st, px] = await Promise.all([
      xrpl<{
        error?: string;
        account_data?: { Balance: string; OwnerCount: number; Sequence: number };
      }>(f, "account_info", { account, ledger_index: "validated" }),
      xrpl<{
        state?: { validated_ledger?: { seq: number; reserve_base: number; reserve_inc: number } };
      }>(f, "server_state", {}),
      coinPrices(f, ["ripple"]),
    ]);
    const d = info.account_data;
    if (!d) return { items: [], notChecked: [] };
    const vl = st.state?.validated_ledger;
    const base = BigInt(vl?.reserve_base ?? 1_000_000),
      inc = BigInt(vl?.reserve_inc ?? 200_000);
    const bal = BigInt(d.Balance),
      reserve = base + inc * BigInt(d.OwnerCount);
    const spend = bal > reserve ? bal - reserve : 0n;
    const p = px.ripple,
      x = (v: bigint) => Number(v) / 1e6,
      usd = (v: bigint) => (p ? Math.round(x(v) * p * 100) / 100 : null);
    const ev = [
      {
        chainId: 0,
        address: account,
        call: "xrpl account_info (validated)",
        args: [],
        raw: `${d.Balance} drops, OwnerCount ${d.OwnerCount}, Sequence ${d.Sequence}`,
      },
    ];
    const items: NewFound[] = [];
    if (spend > 0n)
      items.push({
        kind: "balance",
        protocol: "XRP Ledger",
        chainId: 0,
        what: `${x(spend)} XRP spendable on ${account} (balance ${x(bal)} XRP minus ${x(reserve)} XRP reserve; exact balance, USD estimate)`,
        valueUsd: usd(spend),
        action:
          "Send it from an XRP wallet you control (Xaman, Ledger Live). Sign in your own wallet; never type a seed or family seed into a website. SwapChan never sees keys.",
        confidence: "high",
        evidence: ev,
      } as NewFound);
    const seqOk = vl ? d.Sequence + 256 <= vl.seq : false;
    const fee = inc; // AccountDelete burns one owner-reserve increment
    if (reserve > fee)
      items.push({
        kind: "lead",
        protocol: "XRP reserve",
        chainId: 0,
        what: `${x(reserve)} XRP is locked as account reserve. ${d.OwnerCount === 0 && seqOk ? `AccountDelete would release it on top of the spendable balance: ${x(reserve - fee)} XRP more after the ${x(fee)} XRP deletion fee (everything goes to a destination you choose).` : d.OwnerCount > 0 ? `Remove the ${d.OwnerCount} owned object(s) (trust lines, offers, escrows) first; each frees ${x(inc)} XRP, then AccountDelete can release the base reserve.` : "AccountDelete needs the account Sequence to be 256 ledgers old; try again later."}`,
        valueUsd: usd(reserve > fee ? reserve - fee : 0n),
        action: `Unsigned AccountDelete for your XRP wallet to sign: {"TransactionType":"AccountDelete","Account":"${account}","Destination":"<your other XRP address>","Fee":"${fee}"} (add DestinationTag if sending to an exchange). Sign only in your own wallet.`,
        evidence: ev,
      } as unknown as NewFound);
    return { items, notChecked: [] };
  } catch (e) {
    return {
      items: [],
      notChecked: [`XRP Ledger: not checked (${safeReason(e)})`],
    };
  }
}

/** Signum (ex-Burst) balance via public nodes (exact; USD estimate). */
export async function signumScan(
  f: F,
  input: string,
): Promise<{ items: NewFound[]; notChecked: string[] }> {
  const acct = signumAddress(input) ?? input;
  let last: unknown;
  for (const h of SIGNUM) {
    try {
      const r = await f(`${h}/api?requestType=getAccount&account=${encodeURIComponent(acct)}`, {
        signal: AbortSignal.timeout(5000),
      });
      const j = (await r.json()) as {
        balanceNQT?: string;
        unconfirmedBalanceNQT?: string;
        accountRS?: string;
        errorCode?: number;
        errorDescription?: string;
      };
      if (j.errorCode === 5) return { items: [], notChecked: [] }; // unknown account = never received anything
      if (!j.balanceNQT) {
        last = j.errorDescription ?? r.status;
        continue;
      }
      const nqt = BigInt(j.unconfirmedBalanceNQT ?? j.balanceNQT);
      if (nqt <= 0n) return { items: [], notChecked: [] };
      const px = await coinPrices(f, ["signum"]);
      const amt = Number(nqt) / 1e8;
      return {
        items: [
          {
            kind: "claimable",
            protocol: "Signum (ex-Burst)",
            chainId: 0,
            what: `${amt} SIGNA on ${j.accountRS ?? acct} (exact balance; USD estimate)`,
            valueUsd: px.signum ? Math.round(amt * px.signum * 100) / 100 : null,
            action:
              "Send it from the Signum XT wallet with your own passphrase (old Burst passphrases still work). Sign locally; never type a passphrase into a website. SwapChan never sees keys.",
            confidence: "high",
            evidence: [
              {
                chainId: 0,
                address: acct,
                call: "signum getAccount",
                args: [],
                raw: nqt.toString(),
              },
            ],
          } as NewFound,
        ],
        notChecked: [],
      };
    } catch (e) {
      last = e;
    }
  }
  return {
    items: [],
    notChecked: [`Signum: not checked (nodes unavailable: ${String(last).slice(0, 40)})`],
  };
}

const HORIZON = ["https://horizon.stellar.org"];
/**
 * Chains blocktools can classify (derive/validate only) but SwapChan has no balance source for yet. An address is
 * routed here only when EVERY detectAddress candidate is one of these, so nothing that already routes elsewhere moves.
 */
export const RECOGNISED_ONLY: Record<string, string> = {
  atom: "Cosmos Hub (ATOM)",
  algo: "Algorand (ALGO)",
  dot: "Polkadot (DOT)",
  ton: "TON",
  ada: "Cardano (ADA)",
  xmr: "Monero (XMR)",
};
export function recognisedOnly(a: string): string[] {
  const c = btDetect(a) ?? [];
  return c.length && c.every((k) => k in RECOGNISED_ONLY) ? c : [];
}
/** Stellar G-address (ed25519 public key StrKey, CRC16-XModem checked) — classified by blocktools' detectAddress. */
export function isXlmAddress(a: string): boolean {
  if (!/^G[A-Z2-7]{55}$/.test(a)) return false;
  return (btDetect(a) ?? []).includes("xlm");
}
const stroops = (s: string) => {
  const [w, d = ""] = s.split(".");
  return BigInt(w!) * 10_000_000n + BigInt((d + "0000000").slice(0, 7));
};
/** XLM balance minus the account's base reserve (exact, from Horizon); other assets are listed as leads. */
export async function xlmScan(
  f: F,
  account: string,
): Promise<{ items: NewFound[]; notChecked: string[] }> {
  try {
    const get = async (p: string) => {
      const r = await f(`${HORIZON[0]}${p}`, { signal: AbortSignal.timeout(5000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Horizon ${r.status}`);
      return r.json();
    };
    const [acct, led, px] = await Promise.all([
      get(`/accounts/${account}`) as Promise<{
        subentry_count: number;
        num_sponsoring?: number;
        num_sponsored?: number;
        balances: {
          asset_type: string;
          asset_code?: string;
          asset_issuer?: string;
          balance: string;
          selling_liabilities?: string;
        }[];
      } | null>,
      get(`/ledgers?order=desc&limit=1`) as Promise<{
        _embedded: { records: { base_reserve_in_stroops: number; sequence: number }[] };
      }>,
      coinPrices(f, ["stellar"]),
    ]);
    // Horizon 404 = account never funded (does not exist on the ledger): a measured zero
    if (!acct) return { items: [], notChecked: [] };
    const base = BigInt(led._embedded.records[0]!.base_reserve_in_stroops);
    const nat = acct.balances.find((b) => b.asset_type === "native");
    const bal = nat ? stroops(nat.balance) : 0n;
    const sell = nat?.selling_liabilities ? stroops(nat.selling_liabilities) : 0n;
    const reserve =
      base *
      BigInt(2 + acct.subentry_count + (acct.num_sponsoring ?? 0) - (acct.num_sponsored ?? 0));
    const spend = bal > reserve + sell ? bal - reserve - sell : 0n;
    const p = px.stellar,
      x = (v: bigint) => Number(v) / 1e7,
      usd = (v: bigint) => (p ? Math.round(x(v) * p * 100) / 100 : null);
    const ev = [
      {
        chainId: 0,
        address: account,
        call: "horizon.stellar.org /accounts",
        args: [],
        raw: `${nat?.balance ?? "0"} XLM, subentries ${acct.subentry_count}, base reserve ${base} stroops`,
      },
    ];
    const items: NewFound[] = [];
    if (spend > 0n)
      items.push({
        kind: "balance",
        protocol: "Stellar",
        chainId: 0,
        what: `${x(spend)} XLM spendable on ${account} (balance ${x(bal)} XLM minus ${x(reserve)} XLM reserve${sell ? ` and ${x(sell)} XLM in open offers` : ""}; the reserve stays locked while the account exists; exact balance, USD estimate)`,
        valueUsd: usd(spend),
        action:
          "Send it from a Stellar wallet you control (Lobstr, Freighter, Ledger). Never type a secret key (S...) or seed into a website. SwapChan never sees keys.",
        confidence: "high",
        evidence: ev,
      } as NewFound);
    for (const b of acct.balances
      .filter((b) => b.asset_type !== "native" && stroops(b.balance) > 0n)
      .slice(0, 10))
      items.push({
        kind: "lead",
        protocol: "Stellar asset",
        chainId: 0,
        what: `${b.balance} ${b.asset_code} (issuer ${b.asset_issuer}) on ${account}; not priced`,
        valueUsd: null,
        action: "Check the issuer before trading; move or sell it from your own Stellar wallet.",
        evidence: ev,
      } as unknown as NewFound);
    return { items, notChecked: [] };
  } catch (e) {
    return {
      items: [],
      notChecked: [`Stellar (Horizon): not checked (${safeReason(e)})`],
    };
  }
}

/** GET JSON from the first endpoint that answers (each with its own timeout); 404 → null. */
async function firstOk<T>(
  f: F,
  bases: string[],
  path: string,
  label: string,
  ms = 5000,
): Promise<T | null> {
  let last: unknown;
  for (const b of bases) {
    try {
      const r = await f(`${b}${path}`, { signal: AbortSignal.timeout(ms) });
      if (r.status === 404) return null;
      if (r.ok) return (await r.json()) as T;
      last = r.status;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`${label} unavailable (${String(last).slice(0, 40)})`);
}
const fmt = (v: bigint, d: number) => {
  const s = v.toString().padStart(d + 1, "0");
  const w = s.slice(0, -d),
    fr = s.slice(-d).replace(/0+$/, "");
  return fr ? `${w}.${fr}` : w;
};
const usdOf = (p: number | undefined, v: bigint, d: number) =>
  p ? Math.round((Number(v) / 10 ** d) * p * 100) / 100 : null;

export const ALGOD = ["https://mainnet-api.algonode.cloud", "https://mainnet-api.4160.nodely.dev"];
/** ALGO balance minus the account's minimum balance (exact, from algod); ASAs are only counted. */
export async function algoScan(
  f: F,
  account: string,
): Promise<{ items: NewFound[]; notChecked: string[] }> {
  try {
    const [a, px] = await Promise.all([
      firstOk<{
        amount: number;
        "min-balance": number;
        "auth-addr"?: string;
        "total-assets-opted-in"?: number;
        assets?: unknown[];
      }>(f, ALGOD, `/v2/accounts/${account}?exclude=all`, "algod"),
      coinPrices(f, ["algorand"]),
    ]);
    if (!a || !a.amount) return { items: [], notChecked: [] };
    const bal = BigInt(a.amount),
      min = BigInt(a["min-balance"] ?? 100000);
    const spend = bal > min ? bal - min : 0n;
    const asas = a["total-assets-opted-in"] ?? 0;
    const ev = [
      {
        chainId: 0,
        address: account,
        call: "algod /v2/accounts",
        args: [],
        raw: `${a.amount} microAlgos, min-balance ${a["min-balance"]}`,
      },
    ];
    const items: NewFound[] = [];
    if (spend > 0n)
      items.push({
        kind: "balance",
        protocol: "Algorand",
        chainId: 0,
        what: `${fmt(spend, 6)} ALGO spendable on ${account} (balance ${fmt(bal, 6)} ALGO minus ${fmt(min, 6)} ALGO minimum balance, which stays locked while the account${asas ? ` and its ${asas} asset opt-in(s) exist` : " exists"}${a["auth-addr"] ? `; rekeyed: transactions must be signed by ${a["auth-addr"]}` : ""}; exact balance, USD estimate)`,
        valueUsd: usdOf(px.algorand, spend, 6),
        action:
          "Send it from an Algorand wallet you control (Pera, Defly, Ledger). Never type a 25-word mnemonic into a website. SwapChan never sees keys.",
        confidence: "high",
        evidence: ev,
      } as NewFound);
    return { items, notChecked: [] };
  } catch (e) {
    return {
      items: [],
      notChecked: [`Algorand (algod): not checked (${safeReason(e)})`],
    };
  }
}

export const COSMOS_LCD = [
  "https://cosmos-rest.publicnode.com",
  "https://rest.cosmos.directory/cosmoshub",
  "https://cosmos-api.polkachu.com",
  "https://lcd-cosmoshub.keplr.app",
];
const uatom = (s: string) => BigInt(s.split(".")[0]!);
/** Cosmos Hub: liquid ATOM (spendable), staking rewards (claimable), staked and unbonding ATOM (leads, not liquid). */
export async function atomScan(
  f: F,
  account: string,
): Promise<{ items: NewFound[]; notChecked: string[] }> {
  try {
    type Coin = { denom: string; amount: string };
    const q = <T>(p: string) => firstOk<T>(f, COSMOS_LCD, p, "Cosmos LCD");
    const [bank, del, unb, rew, px] = await Promise.all([
      q<{ balances: Coin[] }>(`/cosmos/bank/v1beta1/balances/${account}?pagination.limit=200`),
      q<{ delegation_responses: { balance: Coin }[] }>(
        `/cosmos/staking/v1beta1/delegations/${account}`,
      ),
      q<{ unbonding_responses: { entries: { balance: string; completion_time: string }[] }[] }>(
        `/cosmos/staking/v1beta1/delegators/${account}/unbonding_delegations`,
      ),
      q<{ total: Coin[] }>(`/cosmos/distribution/v1beta1/delegators/${account}/rewards`),
      coinPrices(f, ["cosmos"]),
    ]);
    const p = px.cosmos;
    const liquid = uatom(bank?.balances.find((c) => c.denom === "uatom")?.amount ?? "0");
    const others = (bank?.balances ?? []).filter(
      (c) => c.denom !== "uatom" && c.amount !== "0",
    ).length;
    const staked = (del?.delegation_responses ?? []).reduce(
      (s, d) => s + (d.balance.denom === "uatom" ? uatom(d.balance.amount) : 0n),
      0n,
    );
    const unbE = (unb?.unbonding_responses ?? []).flatMap((u) => u.entries);
    const unbonding = unbE.reduce((s, e) => s + uatom(e.balance), 0n);
    const reward = uatom(rew?.total?.find((c) => c.denom === "uatom")?.amount ?? "0");
    const ev = [
      {
        chainId: 0,
        address: account,
        call: "Cosmos LCD bank/staking/distribution",
        args: [],
        raw: `liquid ${liquid} uatom, staked ${staked}, unbonding ${unbonding}, rewards ${reward}`,
      },
    ];
    const wallet =
      "Use a Cosmos wallet you control (Keplr, Leap, Ledger). Never type a mnemonic into a website. SwapChan never sees keys.";
    const items: NewFound[] = [];
    if (liquid > 0n)
      items.push({
        kind: "balance",
        protocol: "Cosmos Hub",
        chainId: 0,
        what: `${fmt(liquid, 6)} ATOM spendable on ${account} (liquid bank balance; a small amount is needed for fees; exact balance, USD estimate)`,
        valueUsd: usdOf(p, liquid, 6),
        action: `Send it from ${wallet.slice(4)}`,
        confidence: "high",
        evidence: ev,
      } as NewFound);
    if (reward > 0n)
      items.push({
        kind: "claimable",
        protocol: "Cosmos Hub staking rewards",
        chainId: 0,
        what: `${fmt(reward, 6)} ATOM in unclaimed staking rewards on ${account} (exact, USD estimate)`,
        valueUsd: usdOf(p, reward, 6),
        action: `Claim (withdraw rewards) in your wallet. ${wallet}`,
        confidence: "high",
        evidence: ev,
      } as NewFound);
    if (staked > 0n)
      items.push({
        kind: "lead",
        protocol: "Cosmos Hub staked",
        chainId: 0,
        what: `${fmt(staked, 6)} ATOM staked (delegated) from ${account}; not liquid: undelegating takes 21 days`,
        valueUsd: null,
        action: `Undelegate in your wallet if you want it liquid. ${wallet}`,
        evidence: ev,
      } as unknown as NewFound);
    if (unbonding > 0n)
      items.push({
        kind: "lead",
        protocol: "Cosmos Hub unbonding",
        chainId: 0,
        what: `${fmt(unbonding, 6)} ATOM unbonding on ${account}; liquid after ${unbE
          .map((e) => e.completion_time.slice(0, 10))
          .sort()
          .at(-1)}`,
        valueUsd: null,
        action:
          "Nothing to sign: it returns to the liquid balance automatically when unbonding completes.",
        evidence: ev,
      } as unknown as NewFound);
    if (others)
      items.push({
        kind: "lead",
        protocol: "Cosmos Hub tokens",
        chainId: 0,
        what: `${others} other token denom(s) (IBC/factory) on ${account}; not priced`,
        valueUsd: null,
        action: "Check each denom in your wallet before moving it.",
        evidence: ev,
      } as unknown as NewFound);
    return { items, notChecked: [] };
  } catch (e) {
    return {
      items: [],
      notChecked: [`Cosmos Hub (LCD): not checked (${safeReason(e)})`],
    };
  }
}
