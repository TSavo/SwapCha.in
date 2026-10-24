import { DatabaseSync } from "node:sqlite";
import { encodeFunctionData, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { initLinksDb, legacyEth, shorten } from "./intel.js";
import { recoverUrl, recoveryFlow, verifyRecovery } from "./recover.js";

const fn = (s: string) => [parseAbiItem(`function ${s}`)] as const;
const ME = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const EVIL = "0x000000000000000000000000000000000000dEaD";

describe("verifyRecovery (only pays the owner)", () => {
  it("accepts redeem to self, rejects redeem to anyone else", () => {
    const d = (r: string) =>
      encodeFunctionData({
        abi: fn("redeem(uint256,address,address)"),
        functionName: "redeem",
        args: [5n, r as `0x${string}`, ME],
      });
    expect(verifyRecovery({ to: EVIL, data: d(ME), value: "0" }, ME).verified).toBe(true);
    expect(verifyRecovery({ to: EVIL, data: d(EVIL), value: "0" }, ME).verified).toBe(false);
  });
  it("rejects value, unknown selectors and collect() to a stranger", () => {
    expect(verifyRecovery({ to: EVIL, data: "0x3ccfd60b", value: "1" }, ME).verified).toBe(false);
    expect(verifyRecovery({ to: EVIL, data: "0xa9059cbb", value: "0" }, ME).verified).toBe(false);
    const c = (r: string) =>
      encodeFunctionData({
        abi: fn(
          "collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max))",
        ),
        functionName: "collect",
        args: [{ tokenId: 1n, recipient: r as `0x${string}`, amount0Max: 1n, amount1Max: 1n }],
      });
    expect(verifyRecovery({ to: EVIL, data: c(ME), value: "0" }, ME).verified).toBe(true);
    expect(verifyRecovery({ to: EVIL, data: c(EVIL), value: "0" }, ME).verified).toBe(false);
  });
  it("builds sign-then-swap steps with permanent short links", () => {
    const db = new DatabaseSync(":memory:");
    initLinksDb(db);
    const tx = { chainId: 1, to: EVIL, data: "0x3ccfd60b", value: "0", description: "withdraw()" };
    const f = recoveryFlow(db, shorten, ME, {
      title: "P3D",
      claimTx: tx,
      swapUrl: "https://swapchan.com/?fromChain=1",
    });
    expect(f.steps.map((s) => s.kind)).toEqual(["recover", "swap"]);
    expect(f.steps[0]!.url).toBe(recoverUrl(tx, "P3D", "https://swapchan.com/?fromChain=1"));
    expect(f.steps.every((s) => s.shortUrl?.startsWith("https://swapchan.com/s/"))).toBe(true);
  });
});

/**
 * Ground truth: real recoveries made by 0xeb0e…5c7B. Probes run at (recovery block - 1)
 * on an archive RPC and must find the exact amount and build the exact tx that was sent.
 */
const ARCHIVE = process.env.ARCHIVE_RPC_URL ?? (process.env.LIVE ? "https://eth.drpc.org" : "");
describe.runIf(ARCHIVE)("historical recoveries (archive fixtures)", () => {
  const env = { ...process.env, RPC_URL_1: ARCHIVE };
  it("P3D withdraw() 1.2727 ETH, block 26095610 (tx 0x7b5acf5c…)", async () => {
    const r = await legacyEth(env, ME, 1, 26095609n);
    const p = r.find((x) => x.protocol === "PoWH3D (P3D)")!;
    expect(p.what).toContain("1.272687502039539941 ETH dividends");
    expect((p.claimTx as { data: string }).data).toBe("0x3ccfd60b"); // withdraw(), same as the real tx
    const ev = p.evidence!.find((e) => e.call === "dividendsOf(address)")!;
    expect(ev).toMatchObject({ block: "26095609", raw: "1272687502039539941" });
  }, 60_000);
  it("Fomo3D Long withdraw() 0.016836 ETH, block 26095717 (tx 0xe80e919b…)", async () => {
    const r = await legacyEth(env, ME, 1, 26095716n);
    const p = r.find((x) => x.protocol === "Fomo3D Long")!;
    expect(p.what).toContain("0.016835620814466767 ETH");
    expect((p.claimTx as { data: string; to: string }).data).toBe("0x3ccfd60b");
    expect((p.claimTx as { to: string }).to.toLowerCase()).toBe(
      "0xa62142888aba8370742be823c1782d17a0389da1",
    );
  }, 60_000);
  it("nothing left after the recoveries (no false positives today)", async () => {
    const r = await legacyEth(env, ME, 1, 26095800n);
    expect(r.filter((x) => x.protocol === "PoWH3D (P3D)" || x.protocol === "Fomo3D Long")).toEqual(
      [],
    );
  }, 60_000);
});
