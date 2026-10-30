// Solana send: an UNSIGNED SOL or SPL transfer the user signs in their own wallet. The transaction is
// CONSTRUCTED by blocktools (solBuildTransfer, keyless) using a fresh blockhash from the Solana RPC, then
// re-checked with solVerifyTx against the recipient and amount. SwapChan never signs or broadcasts.
import { blocktools } from "./blocktools.js";
import { solRpc } from "./onchain.js";

type F = typeof fetch;

export type SolSendPlan = {
  family: "solana";
  recipient: string;
  from: string;
  token: string | null; // SPL mint, or null for native SOL
  amount: string;
  tx: { raw: string }; // the unsigned transaction blocktools produced (hex/base64 per the wasm)
  verify: { ok: boolean; failures: string[]; warnings: string[] } | null;
  wallet: string;
};

function toBaseUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  if (frac.length > decimals) throw new Error(`more than ${decimals} decimal places`);
  return (
    BigInt(whole || "0") * 10n ** BigInt(decimals) +
    BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
}

export async function buildSolSend(
  f: F,
  env: NodeJS.ProcessEnv,
  o: { to: string; amount: string; token?: string | undefined; from?: string | undefined },
): Promise<SolSendPlan> {
  const w = blocktools();
  if (!w)
    throw new Error("blocktools is unavailable; not offering an unverified Solana transaction");
  if (!o.from) throw new Error("the sending address (from) is required for a Solana send");
  const from = o.from.trim();
  const to = o.to.trim();
  if (from === to) throw new Error("the sender and recipient are the same address");

  const bh = await solRpc<{ value?: { blockhash?: string } }>(f, env, "getLatestBlockhash", [
    { commitment: "finalized" },
  ]);
  const blockhash = bh.value?.blockhash;
  if (!blockhash) throw new Error("could not fetch a recent Solana blockhash; try again");

  let plan: Record<string, unknown>;
  let expect: Record<string, unknown>;
  let token: string | null = null;
  const t = o.token?.trim();
  if (t && t.toLowerCase() !== "native" && t.toLowerCase() !== "sol") {
    // SPL: read the mint's decimals from the chain.
    const mi = await solRpc<{ value?: { data?: { parsed?: { info?: { decimals?: number } } } } }>(
      f,
      env,
      "getAccountInfo",
      [t, { encoding: "jsonParsed" }],
    );
    const decimals = mi.value?.data?.parsed?.info?.decimals;
    if (decimals === undefined) throw new Error(`"${t}" is not an SPL mint on Solana`);
    const amount = toBaseUnits(o.amount, decimals).toString();
    // create_ata (idempotent): makes the recipient's token account if it doesn't exist, so the send lands.
    plan = { from, to, blockhash, token: { mint: t, amount, decimals, create_ata: true } };
    expect = { owner: from, to, mint: t, amount };
    token = t;
  } else {
    const lamports = toBaseUnits(o.amount, 9).toString();
    if (BigInt(lamports) <= 0n) throw new Error("amount must be above zero");
    plan = { from, to, blockhash, lamports };
    expect = { owner: from, to, lamports };
  }

  let raw: string;
  try {
    raw = w.solBuildTransfer(JSON.stringify(plan));
  } catch (e) {
    throw new Error(`Solana transaction not built: ${e instanceof Error ? e.message : "bad plan"}`);
  }
  const v = JSON.parse(w.solVerifyTx(raw, JSON.stringify(expect))) as {
    ok?: boolean;
    failures?: string[];
    warnings?: string[];
  };
  return {
    family: "solana",
    recipient: to,
    from,
    token,
    amount: o.amount,
    tx: { raw },
    verify: { ok: v.ok === true, failures: v.failures ?? [], warnings: v.warnings ?? [] },
    wallet: "a Solana wallet (Phantom, Solflare, Backpack)",
  };
}
