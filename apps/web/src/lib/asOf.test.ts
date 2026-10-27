import { describe, expect, it } from "vitest";
import { asOfLine } from "./asOf";

describe("asOfLine", () => {
  it("is null without asOf", () => expect(asOfLine({})).toBeNull());
  it("shows time, cached/fresh and block", () => {
    expect(asOfLine({ asOf: "2026-10-26T18:05:00Z", cached: true, block: 23456789 }, "UTC")).toBe(
      "As of 18:05 (cached), Ethereum block 23,456,789",
    );
    expect(asOfLine({ asOf: "2026-10-26T18:05:00Z", cached: false, block: null }, "UTC")).toBe(
      "As of 18:05 (fresh)",
    );
  });
  it("says when refresh was rate-limited", () => {
    expect(
      asOfLine(
        {
          asOf: "2026-10-26T18:05:00Z",
          cached: true,
          freshRefused: "rate-limited",
          retryAfterSeconds: 12,
        },
        "UTC",
      ),
    ).toBe("As of 18:05 (cached). Refresh is rate-limited, try again in 12s");
  });
});
