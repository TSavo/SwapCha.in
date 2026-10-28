import { describe, expect, it } from "vitest";
import { walletTarget } from "./walletLookup";

const A = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const B = "0x000000000000000000000000000000000000dEaD";

describe("walletTarget", () => {
  it("no wallet connected: nothing", () => {
    expect(walletTarget("/airdrops", undefined, undefined)).toEqual({ auto: null, offer: null });
    expect(walletTarget("/airdrops", "  ", A)).toEqual({ auto: null, offer: null });
  });
  it("landing page + connected wallet: auto-route to it", () => {
    expect(walletTarget("/airdrops", A, undefined)).toEqual({
      auto: `/airdrops/${A}`,
      offer: null,
    });
    expect(walletTarget("/airdrops", A, "")).toEqual({ auto: `/airdrops/${A}`, offer: null });
  });
  it("already on the connected wallet's page (any case): nothing", () => {
    expect(walletTarget("/airdrops", A, A.toLowerCase())).toEqual({ auto: null, offer: null });
  });
  it("viewing another address: offer, never auto-redirect", () => {
    expect(walletTarget("/airdrops", A, B)).toEqual({ auto: null, offer: `/airdrops/${A}` });
  });
  it("Solana addresses are encoded as one path segment", () => {
    const sol = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    expect(walletTarget("/airdrops", sol, undefined).auto).toBe(`/airdrops/${sol}`);
  });
});
