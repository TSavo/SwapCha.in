import { describe, expect, it } from "vitest";
import { pickableConnectors, safeIcon } from "./injectedWallets";

describe("fallback wallet picker", () => {
  it("lists every EIP-6963 wallet instead of the first connector", () => {
    const list = pickableConnectors([
      { id: "injected", name: "Injected" },
      { id: "io.metamask", name: "MetaMask" },
      { id: "io.rabby", name: "Rabby Wallet" },
      { id: "io.metamask", name: "MetaMask" },
    ]);
    expect(list.map((c) => c.id)).toEqual(["io.metamask", "io.rabby"]);
  });
  it("keeps the generic injected connector when nothing announced", () => {
    expect(pickableConnectors([{ id: "injected", name: "Injected" }]).map((c) => c.id)).toEqual([
      "injected",
    ]);
  });
  it("is empty with no wallets", () => {
    expect(pickableConnectors([])).toEqual([]);
  });
  it("only renders data:image or https icons", () => {
    expect(safeIcon("data:image/svg+xml;base64,AAA")).toBeDefined();
    expect(safeIcon("https://x/y.png")).toBeDefined();
    expect(safeIcon("javascript:alert(1)")).toBeUndefined();
    expect(safeIcon("data:text/html;base64,AAA")).toBeUndefined();
    expect(safeIcon(undefined)).toBeUndefined();
  });
});
