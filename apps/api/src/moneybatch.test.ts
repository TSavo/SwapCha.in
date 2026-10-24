import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { batchStatus, classify, initBatchStore, parseAddresses, startBatch } from "./moneybatch.js";

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
    expect(() =>
      parseAddresses(
        "abandon ability able about above absent absorb abstract absurd abuse access accident",
      ),
    ).toThrow(/recovery phrase/);
    expect(() => parseAddresses(`0x${"ab".repeat(32)}`)).toThrow(/private key/);
  });
  it("aggregates totals, ranks across wallets and builds one plan", async () => {
    const find = async (a: string) => ({
      address: a,
      items: [
        {
          title: `P3D ${a.slice(0, 4)}`,
          estUsd: a.startsWith("0xd") ? 100 : 5,
          estimateKind: "exact",
          category: "legacy",
          swapUrl: "https://swapchan.com/swap?x",
          steps: [
            {
              kind: "recover",
              url: "https://swapchan.com/recover?x",
              shortUrl: "https://swapchan.com/s/1",
            },
          ],
        },
        {
          title: "Approval",
          estUsd: 999,
          estimateKind: "protected",
          category: "approval",
          action: "revoke",
        },
      ],
      swapAll: { url: "https://swapchan.com/swap?batch", shortUrl: "https://swapchan.com/s/2" },
    });
    const s = startBatch(find, [
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
    ]);
    await new Promise((r) => setTimeout(r, 20));
    const v = batchStatus(s.jobId);
    expect(v.status).toBe("done");
    expect(v.totalEstUsd).toBe(105);
    expect(v.atRiskUsd).toBe(1998);
    expect(v.items[0]!.rank).toBe(1);
    expect(v.plan.phase1_recover).toHaveLength(2);
    expect(v.plan.phase3_swap).toHaveLength(2);
    expect(v.summary).toMatch(/found \$[\d.,]+ exact, on-chain/);
    expect(v.summary).toContain(
      "short: https://swapchan.com/s/1 | full: https://swapchan.com/recover?x",
    );
  });
});

describe("batch dedupe", () => {
  it("counts a name and its resolved address once", async () => {
    const { startBatch, batchStatus } = await import("./moneybatch");
    const find = async (a: string) => ({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      items: [{ title: "x", estUsd: 10, estimateKind: "exact" }],
    });
    const s = startBatch(find as never, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 vitalik.eth");
    await new Promise((r) => setTimeout(r, 20));
    const v = batchStatus(s.jobId);
    expect(v.totalEstUsd).toBe(10);
    expect(v.wallets[1]!.duplicateOf).toBeTruthy();
  });
  it("takes hundreds of labeled addresses (text lines or objects)", () => {
    const hex = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
    const text = Array.from(
      { length: 300 },
      (_, i) => `MetaMask m/44'/60'/0'/0/${i}: ${hex(i + 1)}`,
    ).join("\n");
    const { addresses } = parseAddresses(text);
    expect(addresses).toHaveLength(300);
    expect(addresses[7]!.label).toBe("MetaMask m/44'/60'/0'/0/7");
    const o = parseAddresses([{ address: hex(1), label: "Ledger Live #0" }, hex(2)]);
    expect(o.addresses.map((a) => a.label)).toEqual(["Ledger Live #0", undefined]);
    expect(() => parseAddresses(Array.from({ length: 501 }, (_, i) => hex(i + 1)))).toThrow(
      /max 500/,
    );
  });
  it("persists jobs to batches.db and resumes unfinished ones after a restart", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "batches-")), "batches.db");
    const never = () => new Promise<never>(() => {});
    initBatchStore(file, never);
    const s = startBatch(never, ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]);
    const row = new DatabaseSync(file)
      .prepare("SELECT status FROM batches WHERE id = ?")
      .get(s.jobId) as { status: string };
    expect(row.status).toBe("running");
    // "restart": a new store over the same file resumes the job with a working scanner
    const resumed = initBatchStore(file, async (a) => ({
      address: a,
      items: [{ title: "x", estUsd: 7, estimateKind: "exact", category: "c" }],
    }));
    expect(resumed).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 20));
    const v = batchStatus(s.jobId);
    expect(v.status).toBe("done");
    expect(v.totalEstUsd).toBe(7);
    const after = new DatabaseSync(file)
      .prepare("SELECT status FROM batches WHERE id = ?")
      .get(s.jobId) as { status: string };
    expect(after.status).toBe("done");
  });
});
