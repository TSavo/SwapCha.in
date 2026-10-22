import { describe, expect, it } from "vitest";
import { formatAmount, formatEta, parseAmount, sanitizeAmountInput } from "./amount";

describe("parseAmount", () => {
  it("handles decimals exactly (the old string-padding bug)", () => {
    expect(parseAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount(".5", 6)).toBe(500_000n);
    expect(parseAmount("2.", 6)).toBe(2_000_000n);
  });
  it("rejects invalid, zero and over-precise input", () => {
    expect(parseAmount("", 6)).toBeNull();
    expect(parseAmount("0", 6)).toBeNull();
    expect(parseAmount("abc", 6)).toBeNull();
    expect(parseAmount("0.0000001", 6)).toBeNull();
  });
});

describe("formatting", () => {
  it("truncates and groups", () => {
    expect(formatAmount(1_234_567_891_234n, 6, 2)).toBe("1,234,567.89");
    expect(formatAmount("1000000", 6)).toBe("1");
  });
  it("sanitizes input", () => {
    expect(sanitizeAmountInput("1,5")).toBe("1.5");
    expect(sanitizeAmountInput("1.2.3x")).toBe("1.23");
  });
  it("formats eta", () => {
    expect(formatEta(30)).toBe("30s");
    expect(formatEta(180)).toBe("3 min");
  });
});
