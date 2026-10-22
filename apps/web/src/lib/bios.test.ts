import { describe, expect, it } from "vitest";
import { BIOS, castHref, castOrder } from "./bios";
import { CHARACTERS } from "./characters";

describe("cast bios", () => {
  it("covers every character exactly once", () => {
    const keys = Object.keys(CHARACTERS).sort();
    expect(Object.keys(BIOS).sort()).toEqual(keys);
    expect([...castOrder].sort()).toEqual(keys);
  });
  it("has full bios", () => {
    for (const b of Object.values(BIOS)) {
      expect(b.intro.length).toBeGreaterThan(40);
      expect(b.likes.length).toBeGreaterThan(1);
      expect(b.dislikes.length).toBeGreaterThan(1);
      expect(b.facts.launched).toMatch(/\d{4}/);
      for (const f of b.friends) expect(CHARACTERS[f.who]).toBeDefined();
    }
  });
  it("has final art for everyone", () => {
    expect(Object.values(BIOS).every((b) => b.art === "final")).toBe(true);
    expect(castHref("bnb")).toBe("/cast/bnb");
  });
});
