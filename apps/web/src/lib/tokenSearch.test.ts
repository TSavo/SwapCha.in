import { tokenList } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { searchTokens } from "./tokenSearch";

const sol = tokenList.filter((t) => t.chainId === 792703809);
const eth = tokenList.filter((t) => t.chainId === 1);

describe("searchTokens", () => {
  it("keeps list order (popular first) with no query", () => {
    expect(searchTokens(eth, "")).toEqual(eth);
  });
  it("puts the exact symbol first", () => {
    expect(searchTokens(eth, "usdc")[0]?.symbol).toBe("USDC");
    expect(searchTokens(sol, "wif")[0]?.symbol).toBe("WIF");
  });
  it("matches by name", () => {
    expect(searchTokens(eth, "chainlink")[0]?.symbol).toBe("LINK");
  });
  it("matches by address prefix, case-insensitively", () => {
    const usdc = eth.find((t) => t.symbol === "USDC")!;
    expect(searchTokens(eth, usdc.address.slice(0, 10).toUpperCase().replace("0X", "0x"))[0]).toBe(
      usdc,
    );
  });
  it("returns nothing for junk", () => {
    expect(searchTokens(eth, "zzzzqqq")).toEqual([]);
  });
});
