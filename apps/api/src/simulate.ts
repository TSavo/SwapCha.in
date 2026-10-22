import type { Simulation, TxRequest } from "@swapchan/shared";
import { createPublicClient, http } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import type { Fetch } from "./providers/types.js";

const CHAINS = { 1: mainnet, 8453: base, 42161: arbitrum, 10: optimism, 137: polygon } as const;

export type Simulator = (tx: TxRequest, from: `0x${string}`) => Promise<Simulation>;

/**
 * SWAPCHAN_SIMULATE = "eth_call" | "tenderly" | unset (off).
 * eth_call uses RPC_URL_<chainId> or viem's default public RPC.
 * tenderly needs TENDERLY_ACCOUNT, TENDERLY_PROJECT, TENDERLY_ACCESS_KEY.
 */
export function createSimulator(env: NodeJS.ProcessEnv, f: Fetch = fetch): Simulator | null {
  const mode = env.SWAPCHAN_SIMULATE;
  if (mode === "eth_call") {
    return async (tx, from) => {
      const chain = CHAINS[tx.chainId as keyof typeof CHAINS];
      const client = createPublicClient({ chain, transport: http(env[`RPC_URL_${tx.chainId}`]) });
      try {
        await client.call({ account: from, to: tx.to, data: tx.data, value: BigInt(tx.value) });
        const gas = await client
          .estimateGas({ account: from, to: tx.to, data: tx.data, value: BigInt(tx.value) })
          .catch(() => undefined);
        return { ok: true, method: "eth_call", ...(gas ? { gasUsed: gas.toString() } : {}) };
      } catch (e) {
        return {
          ok: false,
          method: "eth_call",
          error: (e as Error).message.split("\n")[0] ?? "reverted",
        };
      }
    };
  }
  if (mode === "tenderly") {
    const { TENDERLY_ACCOUNT: a, TENDERLY_PROJECT: p, TENDERLY_ACCESS_KEY: k } = env;
    if (!a || !p || !k) return null;
    return async (tx, from) => {
      const res = await f(`https://api.tenderly.co/api/v1/account/${a}/project/${p}/simulate`, {
        method: "POST",
        headers: { "X-Access-Key": k, "content-type": "application/json" },
        body: JSON.stringify({
          network_id: String(tx.chainId),
          from,
          to: tx.to,
          input: tx.data,
          value: tx.value,
          gas: Number(tx.gasLimit ?? 8_000_000),
          save: false,
          simulation_type: "quick",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, method: "tenderly", error: `tenderly ${res.status}` };
      const j = (await res.json()) as {
        transaction?: { status: boolean; gas_used?: number; error_message?: string };
      };
      const t = j.transaction;
      return {
        ok: Boolean(t?.status),
        method: "tenderly",
        ...(t?.gas_used ? { gasUsed: String(t.gas_used) } : {}),
        ...(t?.error_message ? { error: t.error_message } : {}),
      };
    };
  }
  return null;
}
