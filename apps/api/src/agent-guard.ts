import type { Guard } from "./agent-runner.js";
import { verifyTx } from "./txtools.js";

/**
 * The on-chain guard the orchestrator runs on every proposed sign_and_send: SwapChan's own
 * verify_tx, simulated FROM the connected wallet (without `from` verify_tx cannot simulate, and an
 * unsimulated tx with an expected recipient fails closed as danger) and keyed to that wallet as the
 * expected beneficiary. Its verdict replaces the model's self-asserted one.
 *
 * Lending / yield calls (Morpho, Aave v3, Pendle, Merkl) are decoded by verify_tx (lending.ts):
 * their receiver / onBehalf(Of) must be this owner, so a deposit or borrow for the owner passes and
 * the same call for anyone else is danger.
 */
/** Upper bound on one guard run; past it the guard throws and the runner refuses (fail closed). */
export const GUARD_DEADLINE_MS = 20_000;

export function makeVerifyGuard(
  f: typeof fetch,
  env: NodeJS.ProcessEnv,
  deadlineMs = GUARD_DEADLINE_MS,
): Guard {
  return async (chainId, tx, owner) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = verifyTx(f, env, chainId, { ...tx, from: owner }, { recipient: owner });
    work.catch(() => {}); // a late failure after the deadline must not go unhandled
    const r = (await Promise.race([
      work,
      new Promise<never>((_, no) => {
        timer = setTimeout(() => no(new Error("guard deadline exceeded")), deadlineMs);
      }),
    ]).finally(() => clearTimeout(timer))) as {
      verdict: string;
      summary?: string;
    };
    // No recipient here: the runner decodes it from the calldata (never defaults to the owner).
    return { verdict: r.verdict, note: r.summary ?? "" };
  };
}
