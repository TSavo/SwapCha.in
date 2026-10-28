import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SANITIZE_CONFIG } from "./sanitize";

// No DOM in the web test environment (DOMPurify needs one), so this checks the config and that the
// smart wallet's renderMd passes it.
describe("smart wallet sanitizer config", () => {
  it("forbids form controls and the style attribute", () => {
    for (const t of ["form", "input", "button", "textarea", "select"])
      expect(SANITIZE_CONFIG.FORBID_TAGS).toContain(t);
    expect(SANITIZE_CONFIG.FORBID_ATTR).toContain("style");
  });
  it("renderMd uses it", () => {
    const src = readFileSync(new URL("../app/smartwallet/page.tsx", import.meta.url), "utf8");
    expect(src).toContain("DOMPurify.sanitize(html, SANITIZE_CONFIG)");
  });
});
