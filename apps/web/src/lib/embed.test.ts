import { describe, expect, it } from "vitest";
import { embedParams, iframeSnippet, parseEmbedConfig, scriptSnippet } from "./embed";

describe("embed", () => {
  it("parses config safely", () => {
    const c = parseEmbedConfig(
      new URLSearchParams(
        "partner=moon-ab12cd&theme=light&accent=%2322c55e&chan=0&compact=1&lockTo=1",
      ),
    );
    expect(c).toEqual({
      partner: "moon-ab12cd",
      theme: "light",
      accent: "#22c55e",
      chan: false,
      compact: true,
      lockTo: true,
    });
    const bad = parseEmbedConfig(new URLSearchParams("partner=<x>&accent=red;}body{x"));
    expect(bad.partner).toBeUndefined();
    expect(bad.accent).toBeUndefined();
    expect(bad.chan).toBe(true);
  });
  it("builds snippets", () => {
    const o = { partner: "moon-ab12cd", toChain: 8453, toToken: "0xabc", lockTo: true };
    expect(embedParams(o).toString()).toBe(
      "partner=moon-ab12cd&toChain=8453&toToken=0xabc&lockTo=1",
    );
    expect(scriptSnippet(o)).toBe(
      '<script src="https://swapchan.com/widget.js" data-partner="moon-ab12cd" data-to-chain="8453" data-to-token="0xabc" data-lock-to="1" async></script>',
    );
    expect(iframeSnippet(o)).toContain("/embed?partner=moon-ab12cd&amp;toChain=8453");
  });
});
