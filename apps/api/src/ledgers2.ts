/** Keyless balance scans for TON (toncenter/tonapi), Cardano (Koios) and Polkadot (Asset Hub + relay). No tx building. */
import { base58 } from "@scure/base";
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
/** Minimal BLAKE2b (RFC 7693) for storage keys (blake2_128_concat). */
export function blake2b(input: Uint8Array, outlen: number): Uint8Array {
  const IV = [
    0x6a09e667f3bcc908n,
    0xbb67ae8584caa73bn,
    0x3c6ef372fe94f82bn,
    0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n,
    0x9b05688c2b3e6c1fn,
    0x1f83d9abfb41bd6bn,
    0x5be0cd19137e2179n,
  ];
  const S = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  ];
  const M64 = (1n << 64n) - 1n;
  const rotr = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & M64;
  const h = IV.slice();
  h[0] = h[0]! ^ 0x01010000n ^ BigInt(outlen);
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  let t = 0n;
  for (let b = 0; b < blocks; b++) {
    const last = b === blocks - 1;
    const chunk = new Uint8Array(128);
    chunk.set(input.subarray(b * 128, b * 128 + 128));
    t += BigInt(Math.min(128, input.length - b * 128 > 0 ? input.length - b * 128 : 0));
    const m: bigint[] = [];
    for (let i = 0; i < 16; i++) {
      let w = 0n;
      for (let k = 7; k >= 0; k--) w = (w << 8n) | BigInt(chunk[i * 8 + k]!);
      m.push(w);
    }
    const v = [...h, ...IV];
    v[12] = v[12]! ^ (t & M64);
    v[13] = v[13]! ^ (t >> 64n);
    if (last) v[14] = v[14]! ^ M64;
    const G = (a: number, b2: number, c: number, d: number, x: bigint, y: bigint) => {
      v[a] = (v[a]! + v[b2]! + x) & M64;
      v[d] = rotr(v[d]! ^ v[a]!, 32n);
      v[c] = (v[c]! + v[d]!) & M64;
      v[b2] = rotr(v[b2]! ^ v[c]!, 24n);
      v[a] = (v[a]! + v[b2]! + y) & M64;
      v[d] = rotr(v[d]! ^ v[a]!, 16n);
      v[c] = (v[c]! + v[d]!) & M64;
      v[b2] = rotr(v[b2]! ^ v[c]!, 63n);
    };
    for (let r = 0; r < 12; r++) {
      const s = S[r % 10]!;
      G(0, 4, 8, 12, m[s[0]!]!, m[s[1]!]!);
      G(1, 5, 9, 13, m[s[2]!]!, m[s[3]!]!);
      G(2, 6, 10, 14, m[s[4]!]!, m[s[5]!]!);
      G(3, 7, 11, 15, m[s[6]!]!, m[s[7]!]!);
      G(0, 5, 10, 15, m[s[8]!]!, m[s[9]!]!);
      G(1, 6, 11, 12, m[s[10]!]!, m[s[11]!]!);
      G(2, 7, 8, 13, m[s[12]!]!, m[s[13]!]!);
      G(3, 4, 9, 14, m[s[14]!]!, m[s[15]!]!);
    }
    for (let i = 0; i < 8; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 8]!;
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++)
    for (let k = 0; k < 8; k++) out[i * 8 + k] = Number((h[i]! >> BigInt(8 * k)) & 0xffn);
  return out.slice(0, outlen);
}
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
/** SS58 → 32-byte public key (single-byte prefix, checksum verified). */
export function ss58PublicKey(a: string): Uint8Array {
  const d = base58.decode(a);
  if (d.length !== 35 || d[0]! >= 64) throw new Error("unsupported SS58 address");
  const sum = blake2b(
    new Uint8Array([...new TextEncoder().encode("SS58PRE"), ...d.subarray(0, 33)]),
    64,
  );
  if (sum[0] !== d[33] || sum[1] !== d[34]) throw new Error("bad SS58 checksum");
  return d.subarray(1, 33);
}
/** twox128("System") ++ twox128("Account") */
const SYSTEM_ACCOUNT = "26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9";
export const systemAccountKey = (pk: Uint8Array) =>
  `0x${SYSTEM_ACCOUNT}${hex(blake2b(pk, 16))}${hex(pk)}`;
const u128le = (b: Buffer, o: number) => {
  let v = 0n;
  for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]!);
  return v;
};
/** AccountInfo SCALE: nonce,consumers,providers,sufficients (u32 ×4) then free,reserved,frozen,flags (u128 ×4). */
export function decodeAccountInfo(h: string | null): {
  free: bigint;
  reserved: bigint;
  frozen: bigint;
} {
  if (!h) return { free: 0n, reserved: 0n, frozen: 0n };
  const b = Buffer.from(h.replace(/^0x/, ""), "hex");
  if (b.length < 64) throw new Error("short AccountInfo");
  return { free: u128le(b, 16), reserved: u128le(b, 32), frozen: u128le(b, 48) };
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
  pk: Uint8Array,
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
            params: [systemAccountKey(pk)],
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
  let pk: Uint8Array;
  try {
    pk = ss58PublicKey(account);
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
