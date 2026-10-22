import type { Quote, Token } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { type SwapState, say } from "./says";

const BNB: Token = {
  chainId: 56,
  address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  symbol: "BNB",
  name: "BNB",
  decimals: 18,
};
const USDT: Token = {
  chainId: 56,
  address: "0x55d398326f99059fF775485246999027B3197955",
  symbol: "USDT",
  name: "Tether",
  decimals: 18,
};
const q = (id: string, provider: string, toAmount: string) =>
  ({ id, provider, toAmount }) as unknown as Quote;
const base: SwapState = {
  amount: "1",
  amountInvalid: false,
  fromToken: BNB,
  toToken: USDT,
  fromChainName: "BNB Chain",
  toChainName: "BNB Chain",
  connected: false,
  wrongNetwork: false,
  insufficient: false,
  quoting: false,
  phase: "idle",
};

describe("say", () => {
  it("talks about the selected pair while quoting", () => {
    expect(say({ ...base, quoting: true }).text).toContain("1 BNB → USDT on BNB Chain");
  });
  it("names the winner, route count and edge over the worst", () => {
    const t = say({
      ...base,
      quotes: [q("a", "velora", "741000000000000000000"), q("b", "lifi", "739500000000000000000")],
      best: "a",
    }).text;
    expect(t).toContain("2 routes! velora wins: 741 USDT");
    expect(t).toContain("1.5 USDT more than the worst");
    expect(t).toContain("Connect your wallet");
  });
  it("handles no route, wrong network and swap phases", () => {
    expect(say({ ...base, quotes: [] }).mood).toBe("sad");
    expect(
      say({ ...base, connected: true, wrongNetwork: true, quotes: [q("a", "cow", "1")], best: "a" })
        .text,
    ).toContain("Switch your wallet to BNB Chain");
    expect(say({ ...base, phase: "swapping" }).text).toContain("wallet");
  });
  it("warns about unverified pasted tokens", () => {
    const meme = { ...USDT, symbol: "MEME", verified: false } as Token;
    expect(say({ ...base, toToken: meme }).warn).toContain("MEME isn't on my list");
  });
});
