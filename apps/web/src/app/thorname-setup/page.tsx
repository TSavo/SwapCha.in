"use client";

import { useEffect, useState } from "react";

/** One-time: register the "swapchan" THORName so THORChain routes pay our affiliate fee.
 * Must be a native THORChain MsgDeposit (RUNE), signed by a THORChain wallet. Uses the
 * XDEFI-style injected provider (Ctrl / Vultisig: window.xfi.thorchain or window.vultisig.thorchain).
 * Manual memos are shown for any other wallet (Keplr can't send MsgDeposit memos reliably). Not linked in nav. */
const NODE = "https://gateway.liquify.com/chain/thorchain_api";
const NAME = "swapchan";
const PREFERRED = "BTC.BTC";
const BLOCKS_PER_YEAR = 5_256_000n;
const ALIASES: [string, string][] = [
  ["BTC", "bc1qy65xajxwrtp62uk3styn9py7m2k06cdj2wla6n"],
  ["ETH", "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B"],
  ["BASE", "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B"],
  ["BSC", "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B"],
  ["AVAX", "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B"],
];
const UPDATE_AMOUNT = 1_000_000n; // 0.01 RUNE per alias update (also extends expiry slightly)
const TX_FEE = 2_000_000n; // 0.02 RUNE native fee

type Cb = (err: unknown, res: unknown) => void;
type ThorProvider = { request: (a: { method: string; params: unknown[] }, cb: Cb) => void };
const provider = (): ThorProvider | undefined => {
  const w = window as unknown as {
    vultisig?: { thorchain?: ThorProvider };
    xfi?: { thorchain?: ThorProvider };
    ctrl?: { thorchain?: ThorProvider };
  };
  return w.vultisig?.thorchain ?? w.ctrl?.thorchain ?? w.xfi?.thorchain;
};
const call = (p: ThorProvider, method: string, params: unknown[]) =>
  new Promise<unknown>((ok, no) => p.request({ method, params }, (e, r) => (e ? no(e) : ok(r))));
const rune = (x: bigint) => (Number(x) / 1e8).toFixed(4);

type Step = { label: string; memo: string; amount: bigint };

export default function ThornameSetup() {
  const [addr, setAddr] = useState("");
  const [bal, setBal] = useState<bigint | null>(null);
  const [regAmount, setRegAmount] = useState<bigint | null>(null);
  const [usd, setUsd] = useState<number | null>(null);
  const [existing, setExisting] = useState<{
    owner?: string;
    aliases?: { chain: string }[];
  } | null>(null);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(`${NODE}/thorchain/network`)
      .then((r) => r.json())
      .then((n) => {
        const amt =
          BigInt(n.tns_register_fee_rune) + BigInt(n.tns_fee_per_block_rune) * BLOCKS_PER_YEAR;
        setRegAmount(amt);
        setUsd(Number(n.rune_price_in_tor) / 1e8);
      })
      .catch(() => setMsg("Could not read THORChain network fees."));
    refreshName();
  }, []);
  const refreshName = () =>
    fetch(`${NODE}/thorchain/thorname/${NAME}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setExisting)
      .catch(() => setExisting(null));

  const owner = addr || "<your thor1 address>";
  const steps: Step[] = [
    {
      label: `Register "${NAME}" for 1 year (THOR alias, preferred asset ${PREFERRED})`,
      memo: `~:${NAME}:THOR:${owner}:${owner}:${PREFERRED}`,
      amount: regAmount ?? 0n,
    },
    ...ALIASES.map(([chain, a]) => ({
      label: `Add ${chain} alias`,
      memo: `~:${NAME}:${chain}:${a}`,
      amount: UPDATE_AMOUNT,
    })),
  ];
  const has = (chain: string) => !!existing?.aliases?.some((x) => x.chain === chain);

  const connect = async () => {
    const p = provider();
    if (!p) return setMsg("No Ctrl/Vultisig THORChain provider found. Use the manual memos below.");
    try {
      const accts = (await call(p, "request_accounts", [])) as string[];
      const a = accts?.[0];
      if (!a?.startsWith("thor1")) throw new Error("wallet returned no thor1 address");
      setAddr(a);
      const b = await fetch(`${NODE}/cosmos/bank/v1beta1/balances/${a}`).then((r) => r.json());
      setBal(BigInt(b.balances?.find((x: { denom: string }) => x.denom === "rune")?.amount ?? "0"));
      setMsg("");
    } catch (e) {
      setMsg(`Connect failed: ${(e as Error).message ?? e}`);
    }
  };

  const send = async (s: Step) => {
    const p = provider();
    if (!p || !addr) return connect();
    // Pre-flight checks (MsgDeposit can't be dry-run from the browser): balance, name state.
    if (bal === null || bal < s.amount + TX_FEE)
      return setMsg(`Need ${rune(s.amount + TX_FEE)} RUNE, wallet has ${rune(bal ?? 0n)}.`);
    await refreshName();
    if (s === steps[0] && existing?.owner && existing.owner !== addr)
      return setMsg(`"${NAME}" is already owned by ${existing.owner}.`);
    if (s !== steps[0] && existing?.owner !== addr)
      return setMsg("Register first (and wait ~6s for the block) before adding aliases.");
    try {
      const tx = await call(p, "deposit", [
        {
          from: addr,
          asset: { chain: "THOR", symbol: "RUNE", ticker: "RUNE" },
          amount: { amount: Number(s.amount), decimals: 8 },
          memo: s.memo,
        },
      ]);
      setDone((d) => ({ ...d, [s.memo]: String(tx) }));
      setMsg(`Sent: ${tx}`);
      setBal((b) => (b === null ? b : b - s.amount - TX_FEE));
      setTimeout(refreshName, 8000);
    } catch (e) {
      setMsg(`Rejected/failed: ${(e as Error).message ?? JSON.stringify(e)}`);
    }
  };

  return (
    <div className="mt-8 w-full max-w-2xl rounded-3xl border-2 border-violet-500/40 bg-violet-950/80 p-5">
      <h1 className="text-2xl font-black">THORName: {NAME}</h1>
      <p className="mt-2 text-sm text-violet-200">
        Registers the THORChain affiliate name so native BTC/ETH/etc. swaps pay SwapChan&apos;s 10
        bp. Fees accrue as RUNE and auto-swap to {PREFERRED} (to the BTC alias) once past
        THORChain&apos;s threshold, so there are no dust payouts. Status:{" "}
        <b>{existing?.owner ? `registered (owner ${existing.owner})` : "available"}</b>
      </p>
      {regAmount !== null && (
        <p className="mt-2 text-sm">
          Registration: <b>{rune(regAmount)} RUNE</b> + 0.02 fee
          {usd ? ` ≈ $${((Number(regAmount + TX_FEE) / 1e8) * usd).toFixed(2)}` : ""} (10 RUNE fee +
          1 year of blocks). Each alias: 0.03 RUNE.
        </p>
      )}
      <button
        type="button"
        onClick={connect}
        className="mt-3 rounded-full bg-fuchsia-500 px-5 py-2 font-bold text-white"
      >
        {addr ? `${addr}  ${bal !== null ? `${rune(bal)} RUNE` : ""}` : "Connect Ctrl / Vultisig"}
      </button>
      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => {
          const ok = i === 0 ? !!existing?.owner : has(s.label.split(" ")[1] ?? "");
          return (
            <li key={s.label} className="rounded-xl bg-violet-900/60 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {i + 1}. {s.label} {ok && "✅"}
                </span>
                <button
                  type="button"
                  disabled={!addr || !regAmount}
                  onClick={() => send(s)}
                  className="rounded-full bg-fuchsia-500 px-4 py-1 font-bold text-white disabled:opacity-40"
                >
                  Sign
                </button>
              </div>
              <code className="mt-1 block break-all text-xs text-violet-200">
                {s.memo} — {rune(s.amount)} RUNE (MsgDeposit)
              </code>
              {done[s.memo] && <div className="break-all text-xs">tx {done[s.memo]}</div>}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-violet-300">
        Manual (any THORChain wallet with &quot;Deposit&quot;/custom memo, e.g. Vultisig, THORSwap):
        send the amount as a THORChain <i>deposit</i> (not a transfer) with the memo above. Step 1
        must come first; the others are optional (payouts go to BTC via the preferred asset).
      </p>
      {msg && <p className="mt-3 whitespace-pre-wrap break-all text-sm">{msg}</p>}
    </div>
  );
}
