import { describe, expect, it } from "vitest";
import { findMoneyHeadline, isNotClaimableNow, isShownOnly, owedLater } from "./intel.js";
import { safeReason, scrubText, tidyNotChecked } from "./reasons.js";

describe("safeReason", () => {
  it("never leaks a provider URL or raw viem error text", () => {
    const raw = new Error(
      'HTTP request failed.\n\nURL: https://opt-mainnet.g.alchemy.com/v2/SECRETKEY123\nRequest body: {"method":"eth_getLogs"}',
    );
    const r = safeReason(raw);
    expect(r).toBe("RPC request failed");
    expect(r).not.toMatch(/https?:|alchemy|SECRET|Reques/);
    // the truncated form seen live
    expect(safeReason("HTTP request failed. URL: https://x.example/rpc Reques")).toBe(
      "RPC request failed",
    );
  });
  it("marks timeouts as incomplete", () => {
    expect(safeReason(new Error("timed out after 12s"))).toBe(
      "timed out after 12s, results may be incomplete",
    );
    expect(safeReason(new Error("The operation was aborted due to timeout"))).toBe(
      "timed out, results may be incomplete",
    );
  });
  it("keeps short plain reasons and reduces anything else", () => {
    expect(safeReason(new Error("no indexer for this chain"))).toBe("no indexer for this chain");
    expect(safeReason(new Error("429 Too Many Requests"))).toBe("rate limited by the data source");
    expect(safeReason(new Error("x".repeat(200)))).toBe("request failed");
  });
  it("never passes through key-like words or file paths", () => {
    for (const m of [
      "invalid api key 123",
      "Invalid API Key",
      "bad api_key abc",
      "apikey missing",
      "api-key rejected",
    ])
      expect(safeReason(new Error(m))).toBe("RPC request failed");
    for (const m of [
      "ENOENT open /home/tsavo/x.json",
      "cannot read /etc/passwd",
      "missing C:\\Users\\x\\a.txt",
      "/var/lib/app/db.sqlite locked",
    ])
      expect(safeReason(new Error(m))).toBe("request failed");
    expect(safeReason(new Error("no indexer for this chain"))).toBe("no indexer for this chain");
  });
});

describe("tidyNotChecked", () => {
  it("deduplicates a source and keeps the most specific reason", () => {
    const out = tidyNotChecked([
      "beacon validators: not checked (scan finished)",
      "Dash: not checked (timed out after 0.2s)",
      "beacon validators: not checked (timed out after 12s)",
    ]);
    expect(out).toEqual([
      "beacon validators: not checked (timed out after 12s, results may be incomplete)",
      "Dash: not checked (timed out after 0.2s, results may be incomplete)",
    ]);
  });
  it("sanitizes raw RPC errors already in a line", () => {
    const out = tidyNotChecked([
      "Optimism bridge withdrawals: not checked (HTTP request failed. URL: https://mainnet.optimism.io Reques)",
    ]);
    expect(out).toEqual(["Optimism bridge withdrawals: not checked (RPC request failed)"]);
  });
  it("keeps per-chain lines distinct", () => {
    const out = tidyNotChecked([
      "approvals not checked on Base (explorer too slow)",
      "approvals not checked on Optimism",
    ]);
    expect(out).toHaveLength(2);
  });
  it("scrubs URLs and key params from free text", () => {
    expect(scrubText("fetch to https://api.x.com/v1?apikey=abc failed")).toBe("fetch to failed");
  });
});

describe("not claimable now", () => {
  const what =
    "Not claimable now: 172.6 ETH owed in the IronHands queue, paid only in queue order as new deposits/dividends arrive";
  it("detects the item from what or title", () => {
    expect(isNotClaimableNow(what)).toBe(true);
    expect(isNotClaimableNow(`IronHands (Doublr): ${what}`)).toBe(true);
    expect(isNotClaimableNow("1.2 ETH deposited in EtherDelta")).toBe(false);
  });
  it("keeps amount and reason", () => {
    const l = owedLater({ title: `IronHands (Doublr): ${what}` });
    expect(l.protocol).toBe("IronHands (Doublr)");
    expect(l.owed).toBe("172.6 ETH");
    expect(l.reason).toBe("paid only in queue order as new deposits/dividends arrive");
  });
  it("headline says shown, not owed, for balances the contract would not pay", () => {
    expect(findMoneyHeadline(0, 0, 1, 1)).toBe(
      "Nothing claimable right now. 1 item is shown but not claimable now (see owedNotClaimableNow).",
    );
    expect(findMoneyHeadline(0, 0, 3, 2)).toBe(
      "Nothing claimable right now. 1 item is owed to you but not claimable now; 2 items are shown but not claimable now (see owedNotClaimableNow).",
    );
    const w =
      "Shown but not claimable now: the contract shows 1.5 ETH for you but withdraw() would pay nothing (withdraw() reverts for you)";
    expect(isNotClaimableNow(w)).toBe(true);
    expect(isShownOnly(w)).toBe(true);
    expect(isShownOnly(`Fomo3D Long: ${w}`)).toBe(true);
    expect(isShownOnly("Not claimable now: 172.6 ETH owed in the IronHands queue")).toBe(false);
    expect(owedLater({ what: w }).owed).toBe("1.5 ETH");
  });
  it("headline reflects only what is claimable now", () => {
    expect(findMoneyHeadline(0, 0, 1)).toBe(
      "Nothing claimable right now. 1 item is owed to you but not claimable now (see owedNotClaimableNow).",
    );
    expect(findMoneyHeadline(1, 0, 0)).toBe(
      "Found 1 thing to look at, but none with a dollar value claimable now.",
    );
    expect(findMoneyHeadline(2, 12.5, 0)).toBe(
      "Found 2 things worth about $12.5 you can act on now.",
    );
  });
});
