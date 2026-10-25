import { encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { ethForkScan, forkSweep } from "./ethforks.js";
import { createApp } from "./index.js";
import { DUST_CATEGORY, dustNote, isSweepDust } from "./intel.js";
import { recoveryFlow } from "./recover.js";
import { verifySweepTx } from "./sweepverify.js";

const ME = "0x1111111111111111111111111111111111111111";
const EVIL = "0x2222222222222222222222222222222222222222";
const rpcF = (bal = "0xde0b6b3a7640000") =>
  (async (u: string, i?: RequestInit) => {
    if (!i?.body) return new Response(JSON.stringify({ "ethereum-pow-iou": { usd: 1 } }));
    const m = JSON.parse(String(i.body)).method;
    return new Response(
      JSON.stringify({
        result: m === "eth_getBalance" ? bal : m === "eth_gasPrice" ? "0x3b9aca00" : "0x0",
      }),
    );
  }) as unknown as typeof fetch;

describe("verifySweepTx (fork / extra-EVM sweeps fail closed)", () => {
  const ok = { from: ME, to: ME, value: "5", chainId: 10001 };
  it("native back to the owner with the expected chainId verifies", () =>
    expect(verifySweepTx(ok, ME, 10001).verified).toBe(true));
  it("rejects missing/wrong chainId, other recipients, other senders and calldata", () => {
    expect(verifySweepTx({ ...ok, chainId: undefined }, ME, 10001).verified).toBe(false);
    expect(verifySweepTx({ ...ok, chainId: 1 }, ME, 10001).verified).toBe(false);
    expect(verifySweepTx({ ...ok, to: EVIL }, ME, 10001).verified).toBe(false);
    expect(verifySweepTx({ ...ok, from: EVIL }, ME, 10001).verified).toBe(false);
    expect(verifySweepTx({ ...ok, data: "0x12" }, ME, 10001).verified).toBe(false);
    expect(verifySweepTx({ ...ok, value: "0" }, ME, 10001).verified).toBe(false);
  });
  it("token sweep must be transfer(owner) on the token", () => {
    const T = "0x3333333333333333333333333333333333333333";
    const d = (to: string) =>
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as `0x${string}`, 9n],
      });
    expect(
      verifySweepTx({ from: ME, to: T, value: "0", data: d(ME), chainId: 250 }, ME, 250, T)
        .verified,
    ).toBe(true);
    expect(
      verifySweepTx({ from: ME, to: T, value: "0", data: d(EVIL), chainId: 250 }, ME, 250, T)
        .verified,
    ).toBe(false);
  });
});

describe("ETHW / Fantom Get it back (regression for the pasted results)", () => {
  it("fork sweep back to the owner is verified and carries wallet_addEthereumChain params", async () => {
    const r = await forkSweep(rpcF(), "ethw", ME, ME);
    expect(r.verified.verified).toBe(true);
    expect(r.addChain.chainId).toBe("0x2711");
    expect(r.tx.chainId).toBe(10001);
    expect((await forkSweep(rpcF(), "ethw", ME, EVIL)).verified.verified).toBe(false);
  });
  it("fork finding says Get it back on swapchan.com, not an API path; flow step is the /recover page", async () => {
    const { items } = await ethForkScan(rpcF(), ME);
    const it0 = items.find((i) => i.chainId === 10001)!;
    expect(it0.action).toMatch(/^Get it back/);
    expect(it0.action).not.toMatch(/\/onchain\//);
    const flow = recoveryFlow(null, null, ME, {
      title: it0.what,
      swapUrl: "",
      ...it0,
    } as never) as { steps: { label: string; url: string }[] };
    expect(flow.steps[0]!.url).toMatch(/^https:\/\/swapchan\.com\/recover\?sweep=fork&coin=ethw/);
    expect(flow.steps[0]!.label).toMatch(/^Get it back/);
  });
  it("/onchain/fork-sweep rejects an unknown chain", async () => {
    const app = createApp([], {
      env: {},
      scannerFetch: rpcF(),
      pricer: null,
      simulator: null,
      seo: null,
    } as never);
    expect((await app.request(`/onchain/fork-sweep?chain=nope&from=${ME}&to=${ME}`)).status).toBe(
      400,
    );
  });
  it("sub-$0.50 coin balances collapse into one dust note with no instructions", () => {
    const a = {
      title:
        "EthereumPoW (fork coins): 0.00075947617539055 ETHW at your address on EthereumPoW — Merge fork",
      estUsd: 0,
      estimateKind: "exact",
      sweep: {},
    };
    const b = {
      title:
        "Fantom wallet: 0.0100000 FTM at your address on Fantom (exact balance; USD estimate).",
      estUsd: 0,
      estimateKind: "estimate",
      sweep: {},
    };
    expect(isSweepDust(a) && isSweepDust(b)).toBe(true);
    expect(isSweepDust({ ...a, estUsd: 3 })).toBe(false);
    expect(isSweepDust({ ...a, sweep: undefined })).toBe(false);
    const n = dustNote([a, b]);
    expect(n.category).toBe(DUST_CATEGORY);
    expect(n.title).toBe(
      "Dust, not worth moving: 0.00075947617539055 ETHW (EthereumPoW), 0.0100000 FTM (Fantom)",
    );
    expect(n.action).toBe("");
  });
});
