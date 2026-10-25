import { describe, expect, it } from "vitest";
import { sanitizeGaUrl } from "./gaUrl";

const O = "https://swapchan.com";
describe("sanitizeGaUrl (audit: GA leaked /dashboard/<address>)", () => {
  it("redacts addresses, names, hashes, ids, query and hash", () => {
    expect(sanitizeGaUrl(`${O}/dashboard/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`)).toBe(
      `${O}/dashboard/:id`,
    );
    expect(sanitizeGaUrl(`${O}/dashboard/vitalik.eth?tab=x#y`)).toBe(`${O}/dashboard/:id`);
    expect(sanitizeGaUrl(`${O}/wallet/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`)).toBe(
      `${O}/wallet/:id`,
    );
    expect(sanitizeGaUrl(`${O}/bridge-status/0x${"a".repeat(64)}`)).toBe(`${O}/bridge-status/:id`);
    expect(sanitizeGaUrl(`${O}/contract/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`)).toBe(
      `${O}/contract/1/:id`,
    );
    expect(sanitizeGaUrl(`${O}/token/base/0xabc`)).toBe(`${O}/token/base/:id`);
    expect(sanitizeGaUrl(`${O}/partners/abc123?token=secret`)).toBe(`${O}/partners/:id`);
    expect(sanitizeGaUrl(`${O}/airdrops/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh`)).toBe(
      `${O}/airdrops/:id`,
    );
    expect(sanitizeGaUrl(`${O}/swap?recipient=0xabc&fromChain=1`)).toBe(`${O}/swap`);
    expect(sanitizeGaUrl(`${O}/find-money/0x1234567890123456789012345678901234567890`)).toBe(
      `${O}/find-money/:id`,
    );
  });
  it("keeps static and slug routes", () => {
    expect(sanitizeGaUrl(`${O}/`)).toBe(`${O}/`);
    expect(sanitizeGaUrl(`${O}/agents/secure-signing`)).toBe(`${O}/agents/secure-signing`);
    expect(sanitizeGaUrl(`${O}/swap/eth-to-usdc`)).toBe(`${O}/swap/eth-to-usdc`);
    expect(sanitizeGaUrl("/recover")).toBe("/recover");
  });
  it("survives toString() inlining", () => {
    const f = (0, eval)(`(${sanitizeGaUrl.toString()})`) as typeof sanitizeGaUrl;
    expect(f(`${O}/dashboard/vitalik.eth?x=1`)).toBe(`${O}/dashboard/:id`);
  });
});

import { gaParams } from "./gaUrl";

describe("gaParams", () => {
  it("drops tx hashes and addresses, keeps the rest", () => {
    expect(
      gaParams({
        provider: "1inch",
        tx_hash: `0x${"a".repeat(64)}`,
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        sig: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
        host: "example.com",
        value: 12.5,
      }),
    ).toEqual({ provider: "1inch", host: "example.com", value: 12.5 });
  });
});
