import { NATIVE_TOKEN } from "@swapchan/shared";
import { decodeFunctionData, parseAbiItem } from "viem";
import { prices, pxOf } from "./onchain.js";
import type { NewFound } from "./recover.js";

/**
 * Beacon-chain validators funded by this address (deposit-contract history via Blockscout, keyless),
 * state from a public beacon node. 0x00 credentials = withdrawals blocked until a BLS-to-execution change.
 * No owner-signed tx: exits need the validator key, or (0x01/0x02, Pectra) an EIP-7002 request that carries a fee.
 */
type F = typeof fetch;
export const DEPOSIT = "0x00000000219ab540356cBB839Cbe05303d7705Fa";
const BEACON = process.env.BEACON_API ?? "https://ethereum-beacon-api.publicnode.com";
const dep = [
  parseAbiItem(
    "function deposit(bytes pubkey, bytes withdrawal_credentials, bytes signature, bytes32 deposit_data_root)",
  ),
] as const;

export function pubkeyOf(input: string): string | null {
  try {
    const d = decodeFunctionData({ abi: dep, data: input as `0x${string}` });
    return d.args[0] as string;
  } catch {
    return null;
  }
}

export function classify(status: string, creds: string, owner: string) {
  const t = creds.slice(0, 4);
  const toOwner = t !== "0x00" && creds.slice(-40).toLowerCase() === owner.slice(2).toLowerCase();
  if (t === "0x00")
    return {
      stuck: true,
      action:
        "Withdrawals disabled (0x00 BLS credentials). Sign a BLS-to-execution change with your validator mnemonic (staking-deposit-cli / ethdo) to point it at your wallet; balance then auto-sweeps.",
    };
  if (status.startsWith("withdrawal_possible") || status.startsWith("exited"))
    return {
      stuck: false,
      action: `Exited; balance auto-sweeps to 0x${creds.slice(-40)}${toOwner ? " (this wallet)" : ""} — no tx needed.`,
    };
  return {
    stuck: false,
    action: toOwner
      ? "Active. To get the 32 ETH back: voluntary exit with the validator key, or an EIP-7002 exit request from this wallet (withdrawal address) to 0x00000961Ef480Eb55e80D19ad83579A64c007002 with the current fee."
      : `Active; withdrawal address is 0x${creds.slice(-40)}, not this wallet.`,
  };
}

export async function beaconValidators(f: F, owner: `0x${string}`): Promise<NewFound[]> {
  const keys = new Set<string>();
  let q = "";
  for (let page = 0; page < 4; page++) {
    const r = await f(
      `https://eth.blockscout.com/api/v2/addresses/${owner}/transactions?filter=from${q}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!r.ok) break;
    const d = (await r.json()) as {
      items: { to?: { hash: string } | null; raw_input: string; status: string }[];
      next_page_params: Record<string, unknown> | null;
    };
    for (const t of d.items)
      if (t.status === "ok" && t.to?.hash.toLowerCase() === DEPOSIT.toLowerCase()) {
        const k = pubkeyOf(t.raw_input);
        if (k) keys.add(k);
      }
    if (!d.next_page_params) break;
    q =
      "&" +
      new URLSearchParams(
        Object.entries(d.next_page_params).map(([k, v]) => [k, String(v)]),
      ).toString();
  }
  if (!keys.size) return [];
  const ids = [...keys].slice(0, 100);
  const r = await f(`${BEACON}/eth/v1/beacon/states/head/validators?id=${ids.join(",")}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return [];
  const vs = (
    (await r.json()) as {
      data: {
        index: string;
        balance: string;
        status: string;
        validator: { pubkey: string; withdrawal_credentials: string };
      }[];
    }
  ).data;
  const px = await prices(f, [{ chainId: 1, address: NATIVE_TOKEN }]).catch(() => new Map());
  const eth = pxOf(px, 1, NATIVE_TOKEN)?.price ?? null;
  const out: NewFound[] = [];
  for (const v of vs) {
    const bal = Number(v.balance) / 1e9;
    if (bal <= 0) continue;
    const c = classify(v.status, v.validator.withdrawal_credentials, owner);
    out.push({
      kind: c.stuck ? "legacy" : "claimable",
      protocol: "Beacon validator",
      chainId: 1,
      what: `Validator #${v.index}: ${bal.toFixed(4)} ETH, ${v.status}, ${v.validator.withdrawal_credentials.slice(0, 4)} credentials (exact)`,
      valueUsd: eth ? Math.round(bal * eth * 100) / 100 : null,
      action: c.action,
      link: `https://beaconcha.in/validator/${v.index}`,
      confidence: "high",
      evidence: [
        {
          chainId: 1,
          address: BEACON,
          call: "GET /eth/v1/beacon/states/head/validators",
          args: [v.validator.pubkey],
          raw: [v.balance, v.status, v.validator.withdrawal_credentials],
        },
      ],
    });
  }
  return out;
}
