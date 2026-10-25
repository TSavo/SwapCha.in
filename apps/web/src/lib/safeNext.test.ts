import { describe, expect, it } from "vitest";
import { safeNext } from "./safeNext";

describe("safeNext (audit: /recover open redirect)", () => {
  it("allows same-site paths and swapchan.com", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/swap?x=1")).toBe("/swap?x=1");
    expect(safeNext("https://swapchan.com/recover")).toBe("https://swapchan.com/recover");
  });
  it("rejects protocol-relative and look-alikes", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "\\\\evil.com",
      "/\tevil",
      "https://swapchan.com.evil.com/",
      "https://evil.com",
      "javascript:alert(1)",
      "",
      undefined,
    ])
      expect(safeNext(bad)).toBeUndefined();
  });
});
