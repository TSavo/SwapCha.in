import { describe, expect, it } from "vitest";
import { hexLatePenalty } from "./stuck.js";

describe("HEX late penalty", () => {
  it("no penalty in 14-day grace", () => expect(hexLatePenalty(700n, 14)).toBe(0n));
  it("1/700 per late day after grace", () => expect(hexLatePenalty(700n, 24)).toBe(10n));
  it("whole stake after 714 days", () => expect(hexLatePenalty(700n, 1538)).toBe(700n));
});
