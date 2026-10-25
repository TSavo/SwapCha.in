import { describe, expect, it } from "vitest";
import corpus from "./fixtures/verifier-corpus.json" with { type: "json" };
import { verifyRecovery } from "./recover.js";
import { verifySweepTx } from "./sweepverify.js";

/**
 * Parity corpus from blocktools (verifier-corpus.json, 1293 cases): expectations are the old viem TS verifier's
 * verdicts (TS matched 1293/1293 before it was deleted); intentional_diff cases (6) are stricter refusals in the wasm (the TS verified 5 of them).
 * One reason-only diff: a truncated ERC-20 transfer is refused by both, wasm says "calldata does not decode".
 */
type C = {
  kind: string;
  name: string;
  tx: Record<string, unknown>;
  owner: string;
  chainId?: number;
  token?: string;
  intentional_diff?: boolean;
  expect: { verified: boolean; call?: string; reason?: string };
};
const cases = (corpus as { now_s: number; cases: C[] }).cases;
const nowS = (corpus as { now_s: number }).now_s;
const run = (c: C) =>
  c.kind === "sweep"
    ? verifySweepTx(c.tx, c.owner, c.chainId!, c.token)
    : verifyRecovery(c.tx as { to: string; data: string; value: string }, c.owner, nowS);

describe("EVM recovery/sweep verifier (blocktools wasm) vs corpus", () => {
  it("1293 cases", () => {
    expect(cases.length).toBe(1293);
    const bad: string[] = [];
    for (const c of cases) {
      const v = run(c);
      if (c.name === "token truncated" || c.intentional_diff) {
        if (v.verified) bad.push(c.name);
        continue;
      }
      const k = (o: object) => JSON.stringify(o, Object.keys(o).sort());
      if (k(v) !== k(c.expect)) bad.push(`${c.name}: ${JSON.stringify(v)}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
