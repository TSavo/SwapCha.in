import { describe, expect, it } from "vitest";
import { appKitOptions, FEATURED_WALLETS } from "./appkitConfig";

describe("AppKit options", () => {
  it("keeps telemetry, embedded wallets, swaps and onramp off", () => {
    expect(appKitOptions.features).toEqual({
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
    });
  });
  it("defaults EVM to plain EOAs", () => {
    expect(appKitOptions.defaultAccountTypes).toEqual({ eip155: "eoa" });
  });
  it("features well-formed, unique explorer ids", () => {
    const ids = appKitOptions.featuredWalletIds;
    expect(ids).toHaveLength(Object.keys(FEATURED_WALLETS).length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(ids[0]).toBe(FEATURED_WALLETS.metamask);
  });
  it("has no terms/privacy links until those pages exist", () => {
    expect(appKitOptions).not.toHaveProperty("termsConditionsUrl");
    expect(appKitOptions).not.toHaveProperty("privacyPolicyUrl");
  });
});
