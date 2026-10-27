import { describe, expect, it } from "vitest";
import { BURN_HEADLINE, burnAddressResult, isBurnAddress } from "./burnAddresses.js";

describe("burn addresses", () => {
  it("matches EVM burn addresses case-insensitively", () => {
    expect(isBurnAddress("0x000000000000000000000000000000000000dEaD")).toBe(true);
    expect(isBurnAddress("0x000000000000000000000000000000000000DEAD")).toBe(true);
    expect(isBurnAddress("0x0000000000000000000000000000000000000000")).toBe(true);
    expect(isBurnAddress("0xdEAD000000000000000042069420694206942069")).toBe(true);
  });
  it("matches base58 burn addresses exactly", () => {
    expect(isBurnAddress("1nc1nerator11111111111111111111111111111111")).toBe(true);
    expect(isBurnAddress("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb")).toBe(true);
    expect(isBurnAddress("1BitcoinEaterAddressDontSendf59kuE")).toBe(true);
    expect(isBurnAddress("1bitcoineateraddressdontsendf59kue")).toBe(false);
  });
  it("leaves normal addresses alone", () => {
    expect(isBurnAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false);
    expect(isBurnAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe(false);
    expect(isBurnAddress("vitalik.eth")).toBe(false);
    // one character off a burn address is a normal address
    expect(isBurnAddress("0x000000000000000000000000000000000000dEaE")).toBe(false);
    expect(isBurnAddress("0x000000000000000000000000000000000000000d")).toBe(false);
    expect(isBurnAddress("0x0000000000000000000000000000000000000002")).toBe(false);
    expect(isBurnAddress("0xdead000000000000000042069420694206942068")).toBe(false);
    expect(isBurnAddress("1nc1nerator11111111111111111111111111111112")).toBe(false);
    expect(isBurnAddress("1BitcoinEaterAddressDontSendf59kuF")).toBe(false);
  });
  it("returns an empty, zero-total result flagged burnAddress", () => {
    const r = burnAddressResult("0x000000000000000000000000000000000000dEaD");
    expect(r.burnAddress).toBe(true);
    expect(r.totalEstUsd).toBe(0);
    expect(r.items).toEqual([]);
    expect(r.partial).toBe(false);
    expect(r.headline).toBe(BURN_HEADLINE);
  });
});
