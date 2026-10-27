import { describe, expect, it } from "vitest";
import { displayAddress } from "./address";

describe("displayAddress", () => {
  it("shows EVM addresses in full, EIP-55 checksummed", () => {
    const a = displayAddress("0xdac17f958d2ee523a2206206994597c13d831ec7");
    expect(a).toBe("0xdAC17F958D2ee523a2206206994597C13D831ec7");
    expect(a).toHaveLength(42);
    expect(a).not.toMatch(/…|\.\.\./);
  });
  it("re-checksums an all-uppercase or wrongly cased EVM address", () => {
    expect(displayAddress("0xDAC17F958D2EE523A2206206994597C13D831EC7")).toBe(
      "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    );
  });
  it("shows non-EVM addresses in full, unchanged", () => {
    for (const a of [
      "TXtEs6t2oUWQsNos7m68gbHdE9Q5n6x2oN",
      "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2",
      "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    ])
      expect(displayAddress(a)).toBe(a);
  });
  it("empty input is empty", () => {
    expect(displayAddress(undefined)).toBe("");
  });
});
