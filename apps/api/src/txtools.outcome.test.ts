import { describe, expect, it } from "vitest";
import { outcomeChecks, verdictOf } from "./txtools.js";

const R = "0x1111111111111111111111111111111111111111";
const TOK = "0x2222222222222222222222222222222222222222";
const m = (xs: [string, bigint][]) => new Map(xs);

describe("verify_tx expected.recipient / minOut (audit: were no-ops)", () => {
  it("no expectations: no findings", () => {
    expect(outcomeChecks({}, "0x12345678", "0x", false, m([]))).toEqual([]);
  });
  it("fails closed when expectations cannot be simulated", () => {
    expect(verdictOf(outcomeChecks({ recipient: R }, undefined, "0xabcd", false, m([])))).toBe(
      "danger",
    );
    expect(verdictOf(outcomeChecks({ minOut: "1" }, undefined, "0xabcd", false, m([])))).toBe(
      "danger",
    );
  });
  it("danger when the simulation pays nothing to the expected recipient", () => {
    const f = outcomeChecks({ recipient: R }, "0x12345678", "0xdeadbeef", true, m([]));
    expect(verdictOf(f)).toBe("danger");
    expect(f[0]!.check).toBe("recipient");
  });
  it("only caution when the recipient is in calldata but not paid here (cross-chain)", () => {
    const data = `0xabcdef${"0".repeat(24)}${R.slice(2)}` as const;
    expect(verdictOf(outcomeChecks({ recipient: R }, undefined, data, true, m([])))).toBe(
      "caution",
    );
  });
  it("ok when the recipient receives >= minOut", () => {
    expect(
      outcomeChecks({ recipient: R, minOut: "100" }, undefined, "0x", true, m([[TOK, 100n]])),
    ).toEqual([]);
  });
  it("danger when the receipt is below minOut, per outToken", () => {
    expect(
      verdictOf(outcomeChecks({ minOut: "100" }, undefined, "0x", true, m([[TOK, 99n]]))),
    ).toBe("danger");
    expect(
      verdictOf(
        outcomeChecks(
          { minOut: "100", outToken: "0x3333333333333333333333333333333333333333" },
          undefined,
          "0x",
          true,
          m([[TOK, 1000n]]),
        ),
      ),
    ).toBe("danger");
  });
  it("approvals pay nobody: not judged on receipt", () => {
    expect(outcomeChecks({ recipient: R }, "approve", "0x", false, m([]))).toEqual([]);
  });
});
