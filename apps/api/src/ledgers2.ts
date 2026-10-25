/** Keyless balance scans for TON (toncenter/tonapi), Cardano (Koios) and Polkadot (Asset Hub + relay). No tx building. */
import { btDecodeAccountInfo, btDotStorageKey, btSs58Decode } from "./blocktools.js";
import type { NewFound } from "./recover.js";
import { coinPrices } from "./utxochains.js";

type F = typeof fetch;
type Scan = { items: NewFound[]; notChecked: string[] };
const err = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 60);
export const fmtUnits = (v: bigint, d: number) => {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(d + 1, "0");
  const w = s.slice(0, -d),
    fr = s.slice(-d).replace(/0+$/, "");
  return `${neg ? "-" : ""}${fr ? `${w}.${fr}` : w}`;
};
const usd = (p: number | undefined, v: bigint, d: number) =>
  p ? Math.round((Number(v) / 10 ** d) * p * 100) / 100 : null;

/** Try each endpoint in order with its own timeout. `get` returns the parsed value or throws; null = definitively empty. */
async function tryEach<T>(
  eps: string[],
  get: (ep: string, signal: AbortSignal) => Promise<T>,
  label: string,
  ms = 5000,
): Promise<T> {
  let last: unknown = "no endpoints";
  for (const ep of eps) {
    try {
      return await get(ep, AbortSignal.timeout(ms));
    } catch (e) {
      last = err(e);
    }
  }
  throw new Error(`${label} unavailable (${String(last).slice(0, 40)})`);
}
const ok = async (r: Response) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// ---------------- TON ----------------
export const TON_EPS = ["toncenter", "tonapi"] as const;
/** TON: toncenter getAddressBalance (keyless limit ~1 req/s, so one call per scan; a 429 falls to tonapi.io). */
export async function tonScan(f: F, account: string): Promise<Scan> {
  try {
    const [bal, px] = await Promise.all([
      tryEach(
        [...TON_EPS],
        async (ep, signal) => {
          if (ep === "toncenter") {
            const j = (await ok(
              await f(
                `https://toncenter.com/api/v2/getAddressBalance?address=${encodeURIComponent(account)}`,
                { signal },
              ),
            )) as { ok: boolean; result: string };
            if (!j.ok || !/^\d+$/.test(String(j.result))) throw new Error("toncenter bad reply");
            return { nano: BigInt(j.result), status: "", src: "toncenter getAddressBalance" };
          }
          const r = await f(`https://tonapi.io/v2/accounts/${encodeURIComponent(account)}`, {
            signal,
          });
          if (r.status === 404) return { nano: 0n, status: "nonexist", src: "tonapi /v2/accounts" };
          const j = (await ok(r)) as { balance: number | string; status?: string };
          return { nano: BigInt(j.balance), status: j.status ?? "", src: "tonapi /v2/accounts" };
        },
        "TON API",
      ),
      coinPrices(f, ["the-open-network"]),
    ]);
    if (bal.nano <= 0n) return { items: [], notChecked: [] };
    const frozen = bal.status === "frozen";
    return {
      items: [
        {
          kind: frozen ? "lead" : "balance",
          protocol: "TON",
          chainId: 0,
          what: frozen
            ? `${fmtUnits(bal.nano, 9)} TON on ${account}, but the account is FROZEN (storage fees unpaid); it must be unfrozen before it can be spent`
            : `${fmtUnits(bal.nano, 9)} TON spendable on ${account} (TON has no existential deposit, but keep a little for storage and gas fees; jettons and staked TON not checked; exact balance, USD estimate)`,
          valueUsd: frozen ? null : usd(px["the-open-network"], bal.nano, 9),
          action:
            "Send it from a TON wallet you control (Tonkeeper, MyTonWallet, Ledger). Never type a 24-word mnemonic into a website. SwapChan never sees keys.",
          confidence: "high",
          evidence: [
            {
              chainId: 0,
              address: account,
              call: bal.src,
              args: [],
              raw: `${bal.nano} nanoton${bal.status ? `, status ${bal.status}` : ""}`,
            },
          ],
        } as unknown as NewFound,
      ],
      notChecked: [],
    };
  } catch (e) {
    return { items: [], notChecked: [`TON (toncenter/tonapi): not checked (${err(e)})`] };
  }
}

// ---------------- Cardano ----------------
export const KOIOS = ["https://api.koios.rest/api/v1"];
/** Cardano via Koios: this address's ADA (spendable), stake-key rewards (claimable), other addresses of the same stake key and the key deposit (leads). */
export async function adaScan(f: F, account: string): Promise<Scan> {
  try {
    const post = <T>(path: string, body: unknown) =>
      tryEach(
        KOIOS,
        async (ep, signal) =>
          (await ok(
            await f(`${ep}${path}`, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify(body),
              signal,
            }),
          )) as T,
        "Koios",
        8000,
      );
    type Addr = {
      balance: string;
      stake_address: string | null;
      utxo_set?: { asset_list?: unknown[] }[];
    };
    const [ai, px] = await Promise.all([
      post<Addr[]>("/address_info", { _addresses: [account] }),
      coinPrices(f, ["cardano"]),
    ]);
    const a = ai[0];
    type Acct = {
      status: string;
      delegated_pool: string | null;
      total_balance: string;
      utxo?: string;
      rewards_available: string;
      deposit: string;
    };
    const acct = a?.stake_address
      ? (await post<Acct[]>("/account_info", { _stake_addresses: [a.stake_address] }))[0]
      : undefined;
    const p = px.cardano;
    const bal = BigInt(a?.balance ?? "0");
    const tokUtxos = (a?.utxo_set ?? []).filter((u) => (u.asset_list ?? []).length).length;
    const rewards = BigInt(acct?.rewards_available ?? "0");
    const total = BigInt(acct?.total_balance ?? "0");
    const elsewhere = acct?.utxo != null ? BigInt(acct.utxo) - bal : 0n;
    const deposit = acct?.status === "registered" ? BigInt(acct.deposit ?? "0") : 0n;
    const ev = [
      {
        chainId: 0,
        address: account,
        call: "Koios address_info + account_info",
        args: [],
        raw: `address ${bal} lovelace; stake ${a?.stake_address ?? "none"}: total ${total}, rewards ${rewards}, deposit ${deposit}, pool ${acct?.delegated_pool ?? "none"}`,
      },
    ];
    const wallet =
      "a Cardano wallet you control (Eternl, Lace, Yoroi, Ledger). Never type a recovery phrase into a website. SwapChan never sees keys.";
    const items: NewFound[] = [];
    if (bal > 0n)
      items.push({
        kind: "balance",
        protocol: "Cardano",
        chainId: 0,
        what: `${fmtUnits(bal, 6)} ADA spendable on ${account} (${tokUtxos ? `${tokUtxos} UTXO(s) also hold native tokens and must keep their min-UTXO ADA (~1-2 ADA each) unless the tokens move too; ` : ""}${acct?.delegated_pool ? `delegated to ${acct.delegated_pool}; Cardano delegation does not lock funds; ` : ""}exact balance, USD estimate)`,
        valueUsd: usd(p, bal, 6),
        action: `Send it from ${wallet}`,
        confidence: "high",
        evidence: ev,
      } as NewFound);
    if (rewards > 0n)
      items.push({
        kind: "claimable",
        protocol: "Cardano staking rewards",
        chainId: 0,
        what: `${fmtUnits(rewards, 6)} ADA in unwithdrawn staking rewards on stake key ${a!.stake_address} (exact, USD estimate)`,
        valueUsd: usd(p, rewards, 6),
        action: `Withdraw rewards in ${wallet}`,
        confidence: "high",
        evidence: ev,
      } as NewFound);
    if (elsewhere > 0n)
      items.push({
        kind: "lead",
        protocol: "Cardano same wallet",
        chainId: 0,
        what: `${fmtUnits(elsewhere, 6)} more ADA at other addresses sharing stake key ${a!.stake_address} (same wallet; not counted here)`,
        valueUsd: null,
        action: "Open the wallet that owns this stake key; it shows every address.",
        evidence: ev,
      } as unknown as NewFound);
    if (deposit > 0n)
      items.push({
        kind: "lead",
        protocol: "Cardano stake key deposit",
        chainId: 0,
        what: `${fmtUnits(deposit, 6)} ADA stake-key deposit for ${a!.stake_address}; refunded only if the stake key is deregistered (which stops staking)`,
        valueUsd: null,
        action:
          "Only if you no longer want to stake: deregister the stake key in your wallet to get the deposit back.",
        evidence: ev,
      } as unknown as NewFound);
    return { items, notChecked: [] };
  } catch (e) {
    return { items: [], notChecked: [`Cardano (Koios): not checked (${err(e)})`] };
  }
}

// ---------------- Polkadot ----------------
// SS58 decode, System.Account storage key and AccountInfo decode come from blocktools (WASM); no TS copy.
/** AccountInfo SCALE -> free/reserved/frozen; an absent account (null) is zero. */
export function decodeAccountInfo(h: string | null): {
  free: bigint;
  reserved: bigint;
  frozen: bigint;
} {
  if (!h) return { free: 0n, reserved: 0n, frozen: 0n };
  return btDecodeAccountInfo(h);
}
type Bal = { free: bigint; reserved: bigint; frozen: bigint; src: string };
export const DOT_CHAINS = [
  {
    name: "Polkadot Asset Hub",
    ed: 100_000_000n, // 0.01 DOT
    sidecar: "https://polkadot-asset-hub-public-sidecar.parity-chains.parity.io",
    rpc: [
      "https://polkadot-asset-hub-rpc.polkadot.io",
      "https://asset-hub-polkadot-rpc.n.dwellir.com",
      "https://statemint.api.onfinality.io/public",
      "https://dot-rpc.stakeworld.io/assethub",
    ],
  },
  {
    name: "Polkadot relay chain",
    ed: 10_000_000_000n, // 1 DOT
    sidecar: "https://polkadot-public-sidecar.parity-chains.parity.io",
    rpc: ["https://rpc.polkadot.io", "https://polkadot-rpc.publicnode.com"],
  },
];
async function dotBalance(
  f: F,
  c: (typeof DOT_CHAINS)[number],
  account: string,
  pk: string,
): Promise<Bal> {
  return tryEach(
    [c.sidecar, ...c.rpc],
    async (ep, signal) => {
      if (ep === c.sidecar) {
        const j = (await ok(await f(`${ep}/accounts/${account}/balance-info`, { signal }))) as {
          free: string;
          reserved: string;
          frozen: string;
        };
        if (!/^\d+$/.test(j.free ?? "")) throw new Error("sidecar bad reply");
        return {
          free: BigInt(j.free),
          reserved: BigInt(j.reserved ?? "0"),
          frozen: /^\d+$/.test(j.frozen ?? "") ? BigInt(j.frozen) : 0n,
          src: "Parity sidecar balance-info",
        };
      }
      const j = (await ok(
        await f(ep, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "state_getStorage",
            params: [btDotStorageKey(pk)],
          }),
          signal,
        }),
      )) as { result?: string | null; error?: unknown };
      if (j.error || j.result === undefined) throw new Error("rpc error");
      return { ...decodeAccountInfo(j.result), src: `RPC System.Account (${new URL(ep).host})` };
    },
    c.name,
  );
}
/** Polkadot: DOT on Asset Hub (where balances live since the Nov 2025 migration) and any left on the relay chain. */
export async function dotScan(f: F, account: string): Promise<Scan> {
  let pk: string;
  try {
    pk = btSs58Decode(account).account;
  } catch (e) {
    return { items: [], notChecked: [`Polkadot: not checked (${err(e)})`] };
  }
  const px = coinPrices(f, ["polkadot"]).catch(() => ({}) as Record<string, number>);
  const rs = await Promise.all(
    DOT_CHAINS.map((c) =>
      dotBalance(f, c, account, pk).then(
        (b) => ({ c, b }),
        (e) => ({ c, e }),
      ),
    ),
  );
  const p = (await px).polkadot;
  const items: NewFound[] = [];
  const notChecked: string[] = [];
  const wallet =
    "a Polkadot wallet you control (Nova, Talisman, SubWallet, Polkadot Vault, Ledger). Never type a recovery phrase into a website. SwapChan never sees keys.";
  for (const r of rs) {
    if ("e" in r) {
      notChecked.push(`${r.c.name} (sidecar/RPC): not checked (${err(r.e)})`);
      continue;
    }
    const { free, reserved, frozen, src } = r.b;
    const lockedFree = frozen > reserved ? frozen - reserved : 0n;
    const spend = free > lockedFree ? free - lockedFree : 0n;
    const ev = [
      {
        chainId: 0,
        address: account,
        call: src,
        args: [],
        raw: `${r.c.name}: free ${free}, reserved ${reserved}, frozen ${frozen} planck`,
      },
    ];
    if (spend > 0n)
      items.push({
        kind: "balance",
        protocol: r.c.name,
        chainId: 0,
        what: `${fmtUnits(spend, 10)} DOT spendable on ${r.c.name} for ${account} (free ${fmtUnits(free, 10)} minus ${fmtUnits(lockedFree, 10)} frozen; keep ${fmtUnits(r.c.ed, 10)} DOT existential deposit or the account is reaped and the remainder burned; exact balance, USD estimate)`,
        valueUsd: usd(p, spend, 10),
        action: `Send it from ${wallet}`,
        confidence: "high",
        evidence: ev,
      } as NewFound);
    if (frozen > 0n || reserved > 0n)
      items.push({
        kind: "lead",
        protocol: `${r.c.name} locked`,
        chainId: 0,
        what: `${fmtUnits(frozen > reserved ? frozen : reserved, 10)} DOT locked on ${r.c.name} for ${account} (frozen ${fmtUnits(frozen, 10)}, reserved ${fmtUnits(reserved, 10)}: staking, governance votes, vesting or deposits); not liquid`,
        valueUsd: null,
        action: `Check locks in ${wallet} (unbonding takes 28 days; governance locks expire on their own).`,
        evidence: ev,
      } as unknown as NewFound);
  }
  return { items, notChecked };
}
