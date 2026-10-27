import { describe, expect, it } from "vitest";
import { fullAddress } from "./addrDisplay.js";

describe("fullAddress", () => {
  it("EIP-55 checksums EVM addresses and never shortens them", () => {
    const out = fullAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    expect(out).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(out).toHaveLength(42);
    expect(out).not.toContain("…");
  });
  it("leaves non-EVM addresses exactly as given", () => {
    for (const a of [
      "TXtEs6t2oUWQsNos7m68gbHdE9Q5n6x2oN",
      "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2",
      "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    ])
      expect(fullAddress(a)).toBe(a);
  });
});
