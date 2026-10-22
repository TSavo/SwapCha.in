import { describe, expect, it } from "vitest";
import {
  embedParams,
  iframeSnippet,
  nextRef,
  parseEmbedConfig,
  REF_TTL_MS,
  refFromUrl,
  scriptSnippet,
} from "./embed";

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

describe("affiliate refs", () => {
  it("parses ?ref= and ?partner=", () => {
    expect(refFromUrl(new URLSearchParams("ref=Moon-ab12cd"))).toBe("moon-ab12cd");
    expect(refFromUrl(new URLSearchParams("partner=moon-ab12cd"))).toBe("moon-ab12cd");
    expect(refFromUrl(new URLSearchParams("ref=<bad>"))).toBeUndefined();
  });
  it("last click wins, no-ref keeps, expires after 30 days", () => {
    const old = { id: "a-111111", exp: 1000 + REF_TTL_MS };
    expect(nextRef("b-222222", old, 2000)).toEqual({ id: "b-222222", exp: 2000 + REF_TTL_MS });
    expect(nextRef(undefined, old, 2000)).toBe(old);
    expect(nextRef(undefined, old, 1001 + REF_TTL_MS)).toBeNull();
  });
});
