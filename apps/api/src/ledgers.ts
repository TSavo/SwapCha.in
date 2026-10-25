import { base58xrp } from "@scure/base";
import { createHash } from "node:crypto";
import type { NewFound } from "./recover.js";
import { coinPrices } from "./utxochains.js";

type F = typeof fetch;
const sha256 = (d: Uint8Array) => createHash("sha256").update(d).digest();
const XRPL = ["https://xrplcluster.com", "https://s1.ripple.com:51234", "https://s2.ripple.com:51234"];
const SIGNUM = ["https://europe.signum.network", "https://brazil.signum.network", "https://us-east.signum.network"];

/** Classic XRP Ledger r-address with a valid checksum (Ripple base58 alphabet). */
export function isXrpAddress(a: string): boolean {
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)) return false;
  try {
    const raw = base58xrp.decode(a);
    if (raw.length !== 25 || raw[0] !== 0) return false;
    const ck = sha256(sha256(raw.slice(0, 21)));
    return ck.subarray(0, 4).equals(Buffer.from(raw.slice(21)));
  } catch { return false; }
}
/** Signum (ex-Burst) Reed-Solomon address S-XXXX-XXXX-XXXX-XXXXX or BURST-...; returns the S- form. */
export function signumAddress(a: string): string | null {
  const m = /^(?:S|BURST)-([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{5})$/i.exec(a.trim());
  return m ? `S-${m[1]!.toUpperCase()}` : null;
}

async function xrpl<T>(f: F, method: string, params: Record<string, unknown>): Promise<T> {
  let last: unknown;
  for (const u of XRPL) {
    try {
      const r = await f(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params: [params] }), signal: AbortSignal.timeout(5000) });
      const j = (await r.json()) as { result?: T & { status?: string; error?: string } };
      if (j.result && (j.result.status === "success" || j.result.error === "actNotFound")) return j.result;
      last = j.result?.error ?? r.status;
    } catch (e) { last = e; }
  }
  throw new Error(`XRPL unavailable (${String(last)})`);
}

/** XRP balance, locked reserve, and whether AccountDelete can release the reserve (exact drops; USD estimate). */
export async function xrpScan(f: F, account: string): Promise<{ items: NewFound[]; notChecked: string[] }> {
  try {
    const [info, st, px] = await Promise.all([
      xrpl<{ error?: string; account_data?: { Balance: string; OwnerCount: number; Sequence: number } }>(f, "account_info", { account, ledger_index: "validated" }),
      xrpl<{ state?: { validated_ledger?: { seq: number; reserve_base: number; reserve_inc: number } } }>(f, "server_state", {}),
      coinPrices(f, ["ripple"]),
    ]);
    const d = info.account_data;
    if (!d) return { items: [], notChecked: [] };
    const vl = st.state?.validated_ledger;
    const base = BigInt(vl?.reserve_base ?? 1_000_000), inc = BigInt(vl?.reserve_inc ?? 200_000);
    const bal = BigInt(d.Balance), reserve = base + inc * BigInt(d.OwnerCount);
    const spend = bal > reserve ? bal - reserve : 0n;
    const p = px.ripple, x = (v: bigint) => Number(v) / 1e6, usd = (v: bigint) => (p ? Math.round(x(v) * p * 100) / 100 : null);
    const ev = [{ chainId: 0, address: account, call: "xrpl account_info (validated)", args: [], raw: `${d.Balance} drops, OwnerCount ${d.OwnerCount}, Sequence ${d.Sequence}` }];
    const items: NewFound[] = [];
    if (spend > 0n)
      items.push({
        kind: "claimable", protocol: "XRP Ledger", chainId: 0,
        what: `${x(spend)} XRP spendable on ${account} (balance ${x(bal)} XRP minus ${x(reserve)} XRP reserve; exact balance, USD estimate)`,
        valueUsd: usd(spend),
        action: "Send it from an XRP wallet you control (Xaman, Ledger Live). Sign in your own wallet; never type a seed or family seed into a website. SwapChan never sees keys.",
        confidence: "high", evidence: ev,
      } as NewFound);
    const seqOk = vl ? d.Sequence + 256 <= vl.seq : false;
    const fee = inc; // AccountDelete burns one owner-reserve increment
    if (reserve > fee)
      items.push({
        kind: "lead", protocol: "XRP reserve", chainId: 0,
        what: `${x(reserve)} XRP is locked as account reserve. ${d.OwnerCount === 0 && seqOk ? `AccountDelete would release it on top of the spendable balance: ${x(reserve - fee)} XRP more after the ${x(fee)} XRP deletion fee (everything goes to a destination you choose).` : d.OwnerCount > 0 ? `Remove the ${d.OwnerCount} owned object(s) (trust lines, offers, escrows) first; each frees ${x(inc)} XRP, then AccountDelete can release the base reserve.` : "AccountDelete needs the account Sequence to be 256 ledgers old; try again later."}`,
        valueUsd: usd(reserve > fee ? reserve - fee : 0n),
        action: `Unsigned AccountDelete for your XRP wallet to sign: {"TransactionType":"AccountDelete","Account":"${account}","Destination":"<your other XRP address>","Fee":"${fee}"} (add DestinationTag if sending to an exchange). Sign only in your own wallet.`,
        evidence: ev,
      } as unknown as NewFound);
    return { items, notChecked: [] };
  } catch (e) {
    return { items: [], notChecked: [`XRP Ledger: not checked (${String((e as Error).message).slice(0, 60)})`] };
  }
}

/** Signum (ex-Burst) balance via public nodes (exact; USD estimate). */
export async function signumScan(f: F, input: string): Promise<{ items: NewFound[]; notChecked: string[] }> {
  const acct = signumAddress(input) ?? input;
  let last: unknown;
  for (const h of SIGNUM) {
    try {
      const r = await f(`${h}/api?requestType=getAccount&account=${encodeURIComponent(acct)}`, { signal: AbortSignal.timeout(5000) });
      const j = (await r.json()) as { balanceNQT?: string; unconfirmedBalanceNQT?: string; accountRS?: string; errorCode?: number; errorDescription?: string };
      if (j.errorCode === 5) return { items: [], notChecked: [] }; // unknown account = never received anything
      if (!j.balanceNQT) { last = j.errorDescription ?? r.status; continue; }
      const nqt = BigInt(j.unconfirmedBalanceNQT ?? j.balanceNQT);
      if (nqt <= 0n) return { items: [], notChecked: [] };
      const px = await coinPrices(f, ["signum"]);
      const amt = Number(nqt) / 1e8;
      return {
        items: [{
          kind: "claimable", protocol: "Signum (ex-Burst)", chainId: 0,
          what: `${amt} SIGNA on ${j.accountRS ?? acct} (exact balance; USD estimate)`,
          valueUsd: px.signum ? Math.round(amt * px.signum * 100) / 100 : null,
          action: "Send it from the Signum XT wallet with your own passphrase (old Burst passphrases still work). Sign locally; never type a passphrase into a website. SwapChan never sees keys.",
          confidence: "high",
          evidence: [{ chainId: 0, address: acct, call: "signum getAccount", args: [], raw: nqt.toString() }],
        } as NewFound],
        notChecked: [],
      };
    } catch (e) { last = e; }
  }
  return { items: [], notChecked: [`Signum: not checked (nodes unavailable: ${String(last).slice(0, 40)})`] };
}
