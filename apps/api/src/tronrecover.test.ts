import { describe, expect, it } from "vitest";
import { recoveryFlow } from "./recover.js";
import { tronSpec, verifyTronSpec } from "./tronrecover.js";

const ME = "TVSVcGEAMVTgR2Tx5G988k1Sy86XGYnWej";
const trig = (data: string, owner = ME, call_value = 0) => ({
  raw_data: {
    contract: [
      {
        type: "TriggerSmartContract",
        parameter: {
          value: {
            owner_address: owner,
            contract_address: "TE2RzoSV3wFK99w6J9UnnZ4vLfXYoxvRwP",
            data,
            call_value,
          },
        },
      },
    ],
  },
});
describe("tron recover spec", () => {
  it("allows a JustLend redeem to the owner and links /recover", () => {
    const tx = trig("db006a75" + "1".padStart(64, "0"));
    expect(verifyTronSpec(tronSpec(tx)!, ME)).toBe(true);
    const r = recoveryFlow(null, null, ME, {
      title: "x",
      claimTx: { chainId: 728126428, tronTx: tx, description: "redeem" },
      swapUrl: "https://swapchan.com/?a=1",
    });
    expect(r.recoverUrl).toMatch(/\/recover\?tron=/);
  });
  it("rejects other owners, TRX value, unknown selectors and transfers", () => {
    expect(verifyTronSpec(tronSpec(trig("db006a75" + "1".padStart(64, "0"), "TOther"))!, ME)).toBe(
      false,
    );
    expect(verifyTronSpec(tronSpec(trig("db006a75" + "1".padStart(64, "0"), ME, 5))!, ME)).toBe(
      false,
    );
    expect(verifyTronSpec(tronSpec(trig("a9059cbb" + "1".padStart(128, "0")))!, ME)).toBe(false);
    expect(
      tronSpec({
        raw_data: { contract: [{ type: "TransferContract", parameter: { value: {} } }] },
      }),
    ).toBeNull();
  });
  it("allows unfreeze v2 for the owner", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "UnfreezeBalanceV2Contract",
            parameter: { value: { owner_address: ME, unfreeze_balance: 5, resource: "ENERGY" } },
          },
        ],
      },
    };
    expect(verifyTronSpec(tronSpec(tx)!, ME)).toBe(true);
  });
});
