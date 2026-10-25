import { TronWeb, utils } from "tronweb";
import { describe, expect, it } from "vitest";
import { approveData, checkTronTx, signedMatches } from "./tronCheck";

const ME = "TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy";
const TO = "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9";
const EVIL = "TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY";
const h = (a: string) => TronWeb.address.toHex(a);

/** Build a tx the way a node would: JSON fields + bytes encoded from them. */
function mk(type: string, value: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const tx: any = {
    visible: false,
    raw_data: {
      contract: [{ type, parameter: { value, type_url: `type.googleapis.com/protocol.${type}` } }],
      ref_block_bytes: "1234",
      ref_block_hash: "0011223344556677",
      expiration: 1_800_000_060_000,
      timestamp: 1_800_000_000_000,
      ...extra,
    },
  };
  const pb = utils.transaction.txJsonToPb(tx);
  tx.raw_data_hex = utils.transaction.txPbToRawDataHex(pb).toLowerCase();
  tx.txID = utils.transaction.txPbToTxID(pb).replace(/^0x/, "");
  return tx;
}

describe("Tron pre-sign check", () => {
  const transfer = (to = TO, amount = 1_000_000, memo?: string) =>
    mk(
      "TransferContract",
      { owner_address: h(ME), to_address: h(to), amount },
      memo ? { data: Buffer.from(memo).toString("hex") } : {},
    );
  const want = {
    owner: ME,
    type: "TransferContract",
    value: { to_address: TO, amount: "1000000" },
    memo: "=:ETH.ETH:0xabc",
  };

  it("accepts the exact deposit we asked for (base58 vs hex addresses)", () => {
    expect(checkTronTx(transfer(TO, 1_000_000, "=:ETH.ETH:0xabc"), want)).toBeNull();
  });
  it("refuses a different recipient", () => {
    expect(checkTronTx(transfer(EVIL, 1_000_000, "=:ETH.ETH:0xabc"), want)).toMatch(/to address/);
  });
  it("refuses a different amount", () => {
    expect(checkTronTx(transfer(TO, 2_000_000, "=:ETH.ETH:0xabc"), want)).toMatch(/amount/);
  });
  it("refuses a swapped memo", () => {
    expect(checkTronTx(transfer(TO, 1_000_000, "=:ETH.ETH:0xevil"), want)).toMatch(/memo/);
  });
  it("refuses a tx from another wallet", () => {
    expect(
      checkTronTx(transfer(TO, 1_000_000, "=:ETH.ETH:0xabc"), { ...want, owner: EVIL }),
    ).toMatch(/connected Tron wallet/);
  });
  it("refuses JSON that was edited after the bytes were made", () => {
    const tx = transfer(TO, 1_000_000, "=:ETH.ETH:0xabc");
    tx.raw_data.contract[0].parameter.value.to_address = h(TO);
    tx.raw_data_hex = transfer(EVIL, 1_000_000, "=:ETH.ETH:0xabc").raw_data_hex;
    expect(checkTronTx(tx, want)).toMatch(/bytes do not match/);
  });
  it("refuses an unexpected contract type or several contracts", () => {
    expect(checkTronTx(transfer(), { ...want, type: "TriggerSmartContract" })).toMatch(
      /unexpected/,
    );
    const tx = transfer();
    tx.raw_data.contract.push(tx.raw_data.contract[0]);
    expect(checkTronTx(tx, want)).toMatch(/exactly one/);
    expect(checkTronTx({} as any, want)).toMatch(/exactly one/);
  });

  const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const call = (data: string, call_value = 0, fee_limit = 150_000_000) =>
    mk(
      "TriggerSmartContract",
      {
        owner_address: h(ME),
        contract_address: h(USDT),
        data,
        ...(call_value ? { call_value } : {}),
      },
      { fee_limit },
    );
  const data = approveData(TO, "5000000");
  const callWant = {
    owner: ME,
    type: "TriggerSmartContract",
    value: { contract_address: USDT, data, call_value: 0 },
    feeLimitMax: 150_000_000,
  };
  it("accepts the exact contract call, refuses changed data, value or fee", () => {
    expect(checkTronTx(call(data), callWant)).toBeNull();
    expect(checkTronTx(call(approveData(EVIL, "5000000")), callWant)).toMatch(/data/);
    expect(checkTronTx(call(data, 1), callWant)).toMatch(/call value/);
    expect(checkTronTx(call(data, 0, 999_000_000), callWant)).toMatch(/fee limit/);
  });
  it("approve calldata is exact-amount ERC-20 approve", () => {
    expect(data).toBe(
      `095ea7b3${h(TO).slice(2).toLowerCase().padStart(64, "0")}${(5_000_000).toString(16).padStart(64, "0")}`,
    );
  });

  it("checks recover system contracts (unfreeze v2, withdraw)", () => {
    const u = mk("UnfreezeBalanceV2Contract", {
      owner_address: h(ME),
      unfreeze_balance: 7_000_000,
      resource: "ENERGY",
    });
    const w = {
      owner: ME,
      type: "UnfreezeBalanceV2Contract",
      value: { owner_address: ME, unfreeze_balance: 7_000_000, resource: "ENERGY" },
    };
    expect(checkTronTx(u, w)).toBeNull();
    expect(checkTronTx(u, { ...w, value: { ...w.value, resource: "BANDWIDTH" } })).toMatch(
      /resource/,
    );
    const wd = mk("WithdrawBalanceContract", { owner_address: h(ME) });
    expect(
      checkTronTx(wd, { owner: ME, type: "WithdrawBalanceContract", value: { owner_address: ME } }),
    ).toBeNull();
  });

  it("the wallet must return the same bytes we checked", () => {
    const tx = transfer();
    expect(signedMatches(tx, { ...tx, signature: ["aa"] } as any)).toBe(true);
    expect(signedMatches(tx, transfer(EVIL))).toBe(false);
  });
});
