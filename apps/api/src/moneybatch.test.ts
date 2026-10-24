import { describe, expect, it } from "vitest";
import { batchStatus, classify, parseAddresses, startBatch } from "./moneybatch.js";

describe("find_money batch", () => {
  it("auto-detects mixed chains and dedupes", () => {
    const { addresses, ignored } = parseAddresses(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045, vitalik.eth\ntoly.sol TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq 0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045 hello",
    );
    expect(addresses.map((a) => a.kind)).toEqual([
      "evm (all EVM chains)",
      "ens/basename (all EVM chains)",
      "sns (solana)",
      "tron",
      "bitcoin",
    ]);
    expect(ignored).toEqual(["hello"]);
    expect(classify("So11111111111111111111111111111111111111112")).toBe("solana");
  });
  it("refuses seed phrases and private keys", () => {
    expect(() => parseAddresses("abandon ability able about above absent absorb abstract absurd abuse access accident")).toThrow(/recovery phrase/);
    expect(() => parseAddresses(`0x${"ab".repeat(32)}`)).toThrow(/private key/);
  });
  it("aggregates totals, ranks across wallets and builds one plan", async () => {
    const find = async (a: string) => ({
      address: a,
      items: [
        { title: `P3D ${a.slice(0, 4)}`, estUsd: a.startsWith("0xd") ? 100 : 5, estimateKind: "exact", category: "legacy", swapUrl: "https://swapchan.com/swap?x", steps: [{ kind: "recover", url: "https://swapchan.com/recover?x", shortUrl: "https://swapchan.com/s/1" }] },
        { title: "Approval", estUsd: 999, estimateKind: "protected", category: "approval", action: "revoke" },
      ],
      swapAll: { url: "https://swapchan.com/swap?batch", shortUrl: "https://swapchan.com/s/2" },
    });
    const s = startBatch(find, ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"]);
    await new Promise((r) => setTimeout(r, 20));
    const v = batchStatus(s.jobId);
    expect(v.status).toBe("done");
    expect(v.totalEstUsd).toBe(105);
    expect(v.atRiskUsd).toBe(1998);
    expect(v.items[0]!.rank).toBe(1);
    expect(v.plan.phase1_recover).toHaveLength(2);
    expect(v.plan.phase3_swap).toHaveLength(2);
    expect(v.summary).toMatch(/found about \$105/);
    expect(v.summary).toContain("short: https://swapchan.com/s/1 | full: https://swapchan.com/recover?x");
  });
});
