import { describe, expect, it } from "vitest";
import { EVM_READ_METHODS, readChain } from "./readchain.js";

describe("read_chain", () => {
  it("only ever allows read RPC methods", () => {
    for (const m of EVM_READ_METHODS) expect(m).toMatch(/^eth_(get|call|blockNumber)/);
    expect(EVM_READ_METHODS.has("eth_sendRawTransaction")).toBe(false);
    expect(EVM_READ_METHODS.has("eth_sendTransaction")).toBe(false);
  });
  it("rejects unknown ops and wrong-chain ops", async () => {
    await expect(readChain(fetch, {}, { chainId: 1, op: "send" as never })).rejects.toThrow(/op must be/);
    await expect(readChain(fetch, {}, { chainId: "bitcoin", op: "storage", address: "bc1qxyz" })).rejects.toThrow(/not valid on Bitcoin/);
  });
  it("reads bitcoin utxos via mempool.space", async () => {
    const f = (async (u: string) => {
      expect(String(u)).toContain("/address/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq/utxo");
      return new Response(JSON.stringify([{ txid: "a", vout: 0, value: 1000 }, { txid: "b", vout: 1, value: 500 }]));
    }) as typeof fetch;
    const r = await readChain(f, {}, { chainId: "btc", op: "btc_utxos", address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" });
    expect(r.readOnly).toBe(true);
    expect((r.result as { totalSats: number }).totalSats).toBe(1500);
  });
});
