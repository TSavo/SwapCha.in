import { base58 } from "@scure/base";
import { SOLANA } from "@swapchan/shared";
import type { Found } from "./intel.js";
import { json, prices, pxOf, solRpc, swapUrl, usdcOf } from "./onchain.js";
import { MARINADE, MARINADE_STATE, marinadeClaimIx } from "./solrecover.js";

type F = typeof fetch;
const SOL = "11111111111111111111111111111111";
const r2 = (n: number) => Math.round(n * 100) / 100;
const solPx = async (f: F) =>
  pxOf(await prices(f, [{ chainId: SOLANA, address: SOL }]).catch(() => new Map()), SOLANA, SOL)
    ?.price ?? null;

/** Marinade delayed-unstake tickets owned by this wallet: claimable once the unstake epoch has passed. */
export async function marinadeTickets(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: string,
): Promise<Found[]> {
  const [accts, ep] = await Promise.all([
    solRpc<{ pubkey: string; account: { data: [string, string] } }[]>(
      f,
      env,
      "getProgramAccounts",
      [
        MARINADE,
        {
          encoding: "base64",
          filters: [{ dataSize: 88 }, { memcmp: { offset: 40, bytes: owner } }],
        },
      ],
    ),
    solRpc<{ epoch: number }>(f, env, "getEpochInfo", []),
  ]);
  if (!accts.length) return [];
  const p = await solPx(f);
  return accts.flatMap((a) => {
    const b = Buffer.from(a.account.data[0], "base64");
    if (base58.encode(b.subarray(8, 40)) !== MARINADE_STATE) return [];
    const sol = Number(b.readBigUInt64LE(72)) / 1e9;
    const created = Number(b.readBigUInt64LE(80));
    const ready = ep.epoch > created;
    return [
      {
        kind: "claimable" as const,
        protocol: "Marinade unstake ticket",
        chainId: SOLANA,
        what: `${a.pubkey}: ${sol.toFixed(4)} SOL ${ready ? "ready to claim" : `unstaking (created epoch ${created}, now ${ep.epoch})`}`,
        valueUsd: p ? r2(sol * p) : null,
        ...(ready
          ? {
              claimTx: {
                chainId: SOLANA,
                solanaTx: {
                  kind: "svm-instructions",
                  data: { instructions: [marinadeClaimIx(a.pubkey, owner)] },
                },
                description: `Marinade claim(${sol.toFixed(4)} SOL) from ticket ${a.pubkey}`,
              },
            }
          : {}),
        action: ready
          ? "Sign the Marinade claim tx, then swap SOL on SwapChan"
          : "Not claimable yet: wait for the unstake epoch to end",
        link: swapUrl(SOLANA, SOL, SOLANA, usdcOf(SOLANA)!, sol.toFixed(4)),
        evidence: [
          {
            chainId: SOLANA,
            address: a.pubkey,
            call: "getProgramAccounts(Marinade, beneficiary memcmp)",
            args: [owner],
            raw: `lamports=${sol * 1e9} created_epoch=${created}`,
          },
        ],
      } as Found,
    ];
  });
}

const KAMINO_MAIN = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
/** Kamino Lend obligations (main market). No tx built: Kamino withdraws need reserve refresh ixs we don't assemble yet. */
export async function kaminoObligations(f: F, owner: string): Promise<Found[]> {
  const obs = await json<
    {
      obligationAddress?: string;
      refreshedStats?: {
        userTotalDeposit?: string | number;
        userTotalBorrow?: string | number;
        netAccountValue?: string | number;
      };
    }[]
  >(
    f,
    `https://api.kamino.finance/kamino-market/${KAMINO_MAIN}/users/${owner}/obligations`,
    undefined,
    10_000,
  );
  return (obs ?? []).flatMap((o) => {
    const dep = Number(o.refreshedStats?.userTotalDeposit ?? 0),
      bor = Number(o.refreshedStats?.userTotalBorrow ?? 0);
    const net = Number(o.refreshedStats?.netAccountValue ?? dep - bor);
    if (!(dep > 0.01)) return [];
    return [
      {
        kind: "lending" as const,
        protocol: "Kamino Lend",
        chainId: SOLANA,
        what: `obligation ${String(o.obligationAddress ?? "")}: $${r2(dep)} supplied, $${r2(bor)} borrowed (net $${r2(net)})`,
        valueUsd: r2(net),
        action:
          "SwapChan can't build the Kamino withdraw tx yet; withdraw in Kamino, then swap on SwapChan",
        link: "https://app.kamino.finance/",
        risk: bor > 0 ? "has borrows: repay before withdrawing" : undefined,
      } as Found,
    ];
  });
}
