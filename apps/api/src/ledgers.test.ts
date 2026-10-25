import { describe, expect, it } from "vitest";
import { isXrpAddress, signumAddress, signumScan, xrpScan } from "./ledgers.js";

const R = "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh";
describe("XRP / Signum", () => {
  it("validates addresses", () => {
    expect(isXrpAddress(R)).toBe(true);
    expect(isXrpAddress("rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLi")).toBe(false);
    expect(isXrpAddress("So11111111111111111111111111111111111111112")).toBe(false);
    expect(signumAddress("BURST-jm3m-MHWM-UVQ6-DSN3Q")).toBe("S-JM3M-MHWM-UVQ6-DSN3Q");
    expect(signumAddress("S-JM3M-MHWM")).toBeNull();
  });
  it("splits spendable from reserve and offers AccountDelete as a lead", async () => {
    const f = (async (_u: string, i: RequestInit) => {
      const m = JSON.parse(String(i.body)).method;
      return new Response(
        JSON.stringify({
          result:
            m === "account_info"
              ? {
                  status: "success",
                  account_data: { Balance: "5000000", OwnerCount: 0, Sequence: 10 },
                }
              : m === "server_state"
                ? {
                    status: "success",
                    state: {
                      validated_ledger: { seq: 1000, reserve_base: 1000000, reserve_inc: 200000 },
                    },
                  }
                : {},
        }),
      );
    }) as unknown as typeof fetch;
    const r = await xrpScan(f, R);
    expect(r.items[0]!.what).toMatch(/^4 XRP spendable/);
    expect((r.items[1] as { kind: string }).kind).toBe("lead");
    expect(r.items[1]!.action).toMatch(/AccountDelete/);
  });
  it("unreachable nodes become not-checked, never throw", async () => {
    const f = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect((await xrpScan(f, R)).notChecked[0]).toMatch(/not checked/);
    expect((await signumScan(f, "S-JM3M-MHWM-UVQ6-DSN3Q")).notChecked[0]).toMatch(/not checked/);
  });
});
