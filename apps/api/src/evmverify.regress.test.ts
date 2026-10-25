import { encodeFunctionData, erc20Abi, serializeTransaction } from "viem";
import { describe, expect, it } from "vitest";
import { blocktools, btVerifyRecovery, btVerifySweepTx } from "./blocktools.js";

// Regressions for blocktools 8dfbe68 (afb2aec vendored): EVM fee cap (max_fee "" = 0.01 ETH tx-sign default) and
// nonzero ETH value alongside ERC-20 calldata, plus the same value rules in the recovery / sweep verifiers.
const OWNER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const transfer = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [OWNER, 1000n],
});
const raw = (o: {
  to: `0x${string}`;
  value?: bigint;
  data?: `0x${string}`;
  gas: bigint;
  fee: bigint;
}) =>
  serializeTransaction({
    chainId: 1,
    type: "eip1559",
    nonce: 0,
    to: o.to,
    value: o.value ?? 0n,
    data: o.data ?? "0x",
    gas: o.gas,
    maxFeePerGas: o.fee,
    maxPriorityFeePerGas: 1n,
  });
const vt = (tx: string, maxFee = "", allowValueWithToken?: boolean) =>
  JSON.parse(blocktools()!.verifyTx(tx, "eth", [], [], 1, maxFee, true, allowValueWithToken)) as {
    ok: boolean;
    failures: string[];
  };

describe("verifyTx (EVM) fee cap and value-with-token", () => {
  it("max_fee '' caps the fee at 0.01 ETH: 21000 gas x 1 gwei passes, x 1000 gwei refused", () => {
    expect(vt(raw({ to: OWNER, value: 1n, gas: 21000n, fee: 10n ** 9n })).failures).not.toContain(
      "fee_above_cap",
    );
    expect(vt(raw({ to: OWNER, value: 1n, gas: 21000n, fee: 10n ** 12n })).failures.join()).toMatch(
      /fee_above_cap/,
    );
  });
  it("an explicit max_fee replaces the default cap", () => {
    expect(
      vt(
        raw({ to: OWNER, value: 1n, gas: 21000n, fee: 10n ** 12n }),
        (10n ** 17n).toString(),
      ).failures.join(),
    ).not.toMatch(/fee_above/);
    expect(
      vt(raw({ to: OWNER, value: 1n, gas: 21000n, fee: 10n ** 9n }), "1000").failures.join(),
    ).toMatch(/fee_above_(cap|max)/);
  });
  it("ETH value with ERC-20 transfer calldata is refused unless allowed", () => {
    const t = raw({ to: TOKEN, value: 5n, data: transfer, gas: 60000n, fee: 10n ** 9n });
    expect(vt(t).failures).toContain("eth_value_with_token_call");
    expect(vt(t, "", true).failures).not.toContain("eth_value_with_token_call");
    expect(
      vt(raw({ to: TOKEN, data: transfer, gas: 60000n, fee: 10n ** 9n })).failures,
    ).not.toContain("eth_value_with_token_call");
  });
});

describe("btVerifyRecovery / btVerifySweepTx value rules", () => {
  const now = Math.floor(Date.now() / 1000);
  it("recovery: any nonzero value is refused, including beside token calldata", () => {
    expect(btVerifyRecovery({ to: TOKEN, data: transfer, value: "1" }, OWNER, now)).toMatchObject({
      verified: false,
      reason: "non-zero value",
    });
    expect(btVerifyRecovery({ to: TOKEN, data: transfer, value: "0x1" }, OWNER, now).verified).toBe(
      false,
    );
  });
  it("token sweep: native value refused; zero value transfer(owner) verified", () => {
    const tx = { from: OWNER, to: TOKEN, data: transfer, chainId: 1 };
    expect(btVerifySweepTx({ ...tx, value: "1" }, OWNER, 1, TOKEN)).toMatchObject({
      verified: false,
      reason: "token sweep must send no native value",
    });
    expect(btVerifySweepTx({ ...tx, value: "0" }, OWNER, 1, TOKEN).verified).toBe(true);
  });
  it("native sweep: calldata refused, value must be nonzero, chainId must match", () => {
    const tx = { from: OWNER, to: OWNER, value: "1000", chainId: 1 };
    expect(btVerifySweepTx({ ...tx, data: transfer }, OWNER, 1).verified).toBe(false);
    expect(btVerifySweepTx({ ...tx, value: "0" }, OWNER, 1)).toMatchObject({
      verified: false,
      reason: "nothing to send",
    });
    expect(btVerifySweepTx(tx, OWNER, 137).verified).toBe(false);
    expect(btVerifySweepTx(tx, OWNER, 1).verified).toBe(true);
  });
});
