import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("chan=0 hides the characters", () => {
  it("Character marks its wrapper with data-chan", () => {
    expect(src("components/Character.tsx")).toMatch(/<figure data-chan\b/);
  });
  it("CSS hides data-chan and next/image-encoded character srcs under .embed-nochan", () => {
    const css = src("app/globals.css");
    expect(css).toContain(".embed-nochan [data-chan]");
    expect(css).toContain('.embed-nochan img[src*="%2Fcharacters%2F"]');
  });
});
