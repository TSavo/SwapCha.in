import { TRON } from "@swapchan/shared";
import { fullAddress } from "./addrDisplay.js";
import { b58decode, json, tronAddr } from "./onchain.js";
import { cached } from "./scanner.js";

/** Tron money that needs a transaction: Stake 2.0 frozen (unfreeze), expired Stake 1.0 (unfreeze), delegated
 *  resources (undelegate per receiver), sTRX (withdraw → queue; queued TRX claim not detected: claimable() is pool-global), JustLend supply (redeem).
 *  Every tx is an unsigned TronGrid transaction whose owner_address is the wallet; Tron system contracts only ever
 *  credit the owner, and the sTRX/jToken calls pay msg.sender. */
type F = typeof fetch;
const TG = "https://api.trongrid.io";
export const STRX = "TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5";
export const JL_COMPTROLLER = "TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7";
export const JTRX = "TE2RzoSV3wFK99w6J9UnnZ4vLfXYoxvRwP";
export type TronItem = {
  kind: "tron";
  protocol: string;
  chainId: number;
  what: string;
  valueUsd: number | null;
  confidence: "high" | "medium";
  claimTx?: { chainId: number; tronTx: unknown; description: string };
  action: string;
  evidence: { chainId: number; address: string; call: string; args: string[]; raw: string }[];
};
type Acct = {
  frozenV2?: { type?: string; amount?: number }[];
  frozen?: { frozen_balance: number; expire_time: number }[];
  account_resource?: {
    frozen_balance_for_energy?: { frozen_balance: number; expire_time: number };
  };
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const word = (r: string | undefined, i = 0) => BigInt(`0x${r?.slice(64 * i, 64 * i + 64) || "0"}`);
export const addrParam = (b58: string) =>
  Buffer.from(b58decode(b58).slice(1, 21)).toString("hex").padStart(64, "0");

export async function tronExtras(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: string,
  acct: Acct,
  trxPx: number | null,
  pxOf: (addr: string) => Promise<{ price: number; decimals?: number } | undefined>,
): Promise<TronItem[]> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = env.TRONGRID_API_KEY;
  const post = async <T>(path: string, b: unknown, attempt = 0): Promise<T> => {
    // free nodes: PublicNode first (generous limits), keyless TronGrid as the fallback (attempts 1, 3)
    const base = attempt % 2 === 0 ? "https://tron-rpc.publicnode.com" : TG;
    if (base === TG) await tgSlot(env.TRONGRID_API_KEY ? 20 : 120);
    try {
      return await json<T>(f, `${base}${path}`, {
        method: "POST",
        headers: base === TG ? headers : { "content-type": "application/json" },
        body: JSON.stringify({ ...(b as object), visible: true }),
      });
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1)));
      return post(path, b, attempt + 1);
    }
  };
  const tx = async (path: string, b: unknown, description: string) => {
    const t = await post<{ Error?: string; transaction?: unknown; result?: { result?: boolean } }>(
      path,
      b,
    ).catch(() => null);
    if (!t || t.Error) return {};
    const tronTx = path === "/wallet/triggersmartcontract" ? t.transaction : t;
    return tronTx ? { claimTx: { chainId: TRON, tronTx, description } } : {};
  };
  const call = (contract: string, sel: string, param = "") =>
    post<{ constant_result?: string[] }>("/wallet/triggerconstantcontract", {
      owner_address: owner,
      contract_address: contract,
      function_selector: sel,
      parameter: param,
    }).then((r) => r.constant_result?.[0]);
  const trig = (contract: string, sel: string, param: string, d: string) =>
    tx(
      "/wallet/triggersmartcontract",
      {
        owner_address: owner,
        contract_address: contract,
        function_selector: sel,
        parameter: param,
        fee_limit: 150_000_000,
        call_value: 0,
      },
      d,
    );
  const usd = (trx: number) => (trxPx ? r2(trx * trxPx) : null);
  const out: TronItem[] = [];
  const now = Date.now();
  const jobs: Promise<unknown>[] = [];

  // Stake 2.0 still frozen → UnfreezeBalanceV2 per resource (starts the 14-day wait; then withdrawExpireUnfreeze)
  for (const fz of acct.frozenV2 ?? []) {
    if (!fz.amount) continue;
    const res = fz.type ?? "BANDWIDTH";
    jobs.push(
      (async () =>
        out.push({
          kind: "tron",
          protocol: `Tron Stake 2.0 (${res.toLowerCase()})`,
          chainId: TRON,
          what: `${fz.amount! / 1e6} TRX frozen for ${res.toLowerCase()} — unfreeze starts a 14-day wait, then withdraw`,
          valueUsd: usd(fz.amount! / 1e6),
          confidence: "high",
          ...(await tx(
            "/wallet/unfreezebalancev2",
            { owner_address: owner, unfreeze_balance: fz.amount, resource: res },
            `UnfreezeBalanceV2 ${fz.amount! / 1e6} TRX (${res})`,
          )),
          action:
            "Sign to unfreeze; after 14 days run find_money again to get the withdraw transaction (votes on this TRX are removed)",
          evidence: [
            {
              chainId: TRON,
              address: owner,
              call: "getaccount.frozenV2",
              args: [res],
              raw: String(fz.amount),
            },
          ],
        }))(),
    );
  }
  // Stake 1.0 expired → UnfreezeBalance (returns TRX immediately)
  const v1: [string, number][] = [];
  const bw = (acct.frozen ?? [])
    .filter((x) => x.expire_time <= now)
    .reduce((s, x) => s + x.frozen_balance, 0);
  if (bw) v1.push(["BANDWIDTH", bw]);
  const en = acct.account_resource?.frozen_balance_for_energy;
  if (en?.frozen_balance && en.expire_time <= now) v1.push(["ENERGY", en.frozen_balance]);
  for (const [res, amt] of v1)
    jobs.push(
      (async () =>
        out.push({
          kind: "tron",
          protocol: `Tron Stake 1.0 (${res.toLowerCase()})`,
          chainId: TRON,
          what: `${amt / 1e6} TRX in an expired Stake 1.0 freeze — unfreezing returns it right away`,
          valueUsd: usd(amt / 1e6),
          confidence: "high",
          ...(await tx(
            "/wallet/unfreezebalance",
            { owner_address: owner, resource: res },
            `UnfreezeBalance (${res})`,
          )),
          action: "Sign to unfreeze; the TRX lands in your wallet",
          evidence: [
            {
              chainId: TRON,
              address: owner,
              call: "getaccount.frozen",
              args: [res],
              raw: String(amt),
            },
          ],
        }))(),
    );
  // Delegated resources → UndelegateResource per receiver and resource
  jobs.push(
    (async () => {
      const idx = await post<{ toAccounts?: string[] }>(
        "/wallet/getdelegatedresourceaccountindexv2",
        { value: owner },
      ).catch(() => ({ toAccounts: [] }));
      await Promise.all(
        (idx.toAccounts ?? []).slice(0, 10).map(async (to) => {
          const d = await post<{
            delegatedResource?: {
              frozen_balance_for_bandwidth?: number;
              frozen_balance_for_energy?: number;
              expire_time_for_bandwidth?: number;
              expire_time_for_energy?: number;
            }[];
          }>("/wallet/getdelegatedresourcev2", { fromAddress: owner, toAddress: to }).catch(() => ({
            delegatedResource: [],
          }));
          for (const r of d.delegatedResource ?? [])
            for (const [res, amt, exp] of [
              ["BANDWIDTH", r.frozen_balance_for_bandwidth, r.expire_time_for_bandwidth],
              ["ENERGY", r.frozen_balance_for_energy, r.expire_time_for_energy],
            ] as const) {
              if (!amt) continue;
              const locked = (exp ?? 0) > now;
              out.push({
                kind: "tron",
                protocol: `Tron delegated ${res.toLowerCase()}`,
                chainId: TRON,
                what: `${amt / 1e6} TRX of ${res.toLowerCase()} delegated to ${fullAddress(to)}${locked ? ` (delegation lock until ${new Date(exp!).toISOString().slice(0, 10)})` : ""}`,
                valueUsd: usd(amt / 1e6),
                confidence: "high",
                ...(locked
                  ? {}
                  : await tx(
                      "/wallet/undelegateresource",
                      { owner_address: owner, receiver_address: to, balance: amt, resource: res },
                      `UndelegateResource ${amt / 1e6} TRX ${res}`,
                    )),
                action: locked
                  ? "Delegation is locked; run find_money again after the lock date"
                  : "Sign to take the resource back (it returns to your frozen balance; then unfreeze)",
                evidence: [
                  {
                    chainId: TRON,
                    address: owner,
                    call: "getdelegatedresourcev2",
                    args: [to, res],
                    raw: String(amt),
                  },
                ],
              });
            }
        }),
      );
    })(),
  );
  // TRC-20 balances (sTRX, jTokens)
  jobs.push(
    (async () => {
      const v1a = await tronV1Account(f, owner, headers);
      const bal = new Map<string, bigint>();
      for (const o of v1a.data?.[0]?.trc20 ?? [])
        for (const [k, v] of Object.entries(o)) bal.set(k, BigInt(v));
      const tasks: Promise<void>[] = [];
      const s = bal.get(STRX) ?? 0n;
      tasks.push(
        (async () => {
          if (s > 0n) {
            const ul = await call(STRX, "viewBalanceOfUnderlying(address)", addrParam(owner));
            const trx = Number(word(ul)) / 1e6;
            out.push({
              kind: "tron",
              protocol: "JustLend sTRX",
              chainId: TRON,
              what: `${(Number(s) / 1e18).toPrecision(6)} sTRX ≈ ${trx.toPrecision(6)} TRX — unstake enters JustLend's 14-day queue`,
              valueUsd: usd(trx),
              confidence: "high",
              ...(await trig(
                STRX,
                "withdraw(uint256)",
                s.toString(16).padStart(64, "0"),
                "sTRX.withdraw(all) — start unstaking",
              )),
              action: "Sign to unstake; after 14 days run find_money again to claim the TRX",
              evidence: [
                {
                  chainId: TRON,
                  address: STRX,
                  call: "balanceOf/viewBalanceOfUnderlying",
                  args: [owner],
                  raw: s.toString(),
                },
              ],
            });
          }
        })(),
      );
      const markets = await cached("jl:markets", 6 * 3600_000, async () => {
        const r = await call(JL_COMPTROLLER, "getAllMarkets()");
        const n = Number(word(r, 1));
        return Array.from({ length: n }, (_, i) =>
          tronAddr(r!.slice(64 * (2 + i) + 24, 64 * (3 + i))),
        );
      }).catch(() => [] as string[]);
      for (const m of markets) {
        const b = bal.get(m) ?? 0n;
        if (b <= 0n) continue;
        tasks.push(
          (async () => {
            const [er, und] = await Promise.all([
              call(m, "exchangeRateStored()"),
              m === JTRX ? undefined : call(m, "underlying()"),
            ]);
            const u = und ? tronAddr(und.slice(24, 64)) : null;
            const p = u
              ? await pxOf(u).catch(() => undefined)
              : trxPx
                ? { price: trxPx, decimals: 6 }
                : undefined;
            const rawUnder = (b * word(er)) / 10n ** 18n;
            const amt = p?.decimals !== undefined ? Number(rawUnder) / 10 ** p.decimals : null;
            out.push({
              kind: "tron",
              protocol: "JustLend supply",
              chainId: TRON,
              what: `JustLend deposit: ${amt === null ? `token ${u}` : `${amt.toPrecision(6)} ${u ? "underlying" : "TRX"}`} supplied (exchangeRateStored)${amt === null || !p?.price ? "; not priced" : ""}`,
              valueUsd: amt !== null && p?.price ? r2(amt * p.price) : null,
              confidence: "high",
              ...(await trig(
                m,
                "redeem(uint256)",
                b.toString(16).padStart(64, "0"),
                "JustLend redeem(all jTokens) — underlying to your wallet",
              )),
              action:
                "Sign to withdraw your deposit to your wallet (fails if it backs an open borrow — repay first)",
              evidence: [
                {
                  chainId: TRON,
                  address: m,
                  call: "balanceOf/exchangeRateStored",
                  args: [owner],
                  raw: `${b}/${word(er)}`,
                },
              ],
            });
          })(),
        );
      }
      await Promise.allSettled(tasks);
    })(),
  );
  await Promise.allSettled(jobs);
  return out;
}

/** /v1/accounts (TRC-20 balances in one call), shared by tronMoney and tronExtras. */
export function tronV1Account(f: F, owner: string, headers: Record<string, string>) {
  return cached(`tg:v1:${owner}`, 30_000, () =>
    json<{ data?: { trc20?: Record<string, string>[] }[] }>(
      f,
      `https://api.trongrid.io/v1/accounts/${owner}`,
      { headers },
    ),
  ).catch(() => ({ data: [] as { trc20?: Record<string, string>[] }[] }));
}

/** Keyless TronGrid allows only a few requests a second: space our calls out process-wide. */
let tgNext = 0;
function tgSlot(gapMs: number) {
  const now = Date.now();
  const at = Math.max(now, tgNext);
  tgNext = at + gapMs;
  return at > now ? new Promise((ok) => setTimeout(ok, at - now)) : Promise.resolve();
}
