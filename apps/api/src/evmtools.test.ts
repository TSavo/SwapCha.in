import {
  decodeFunctionData,
  encodeFunctionData,
  getContractAddress,
  hashTypedData,
  keccak256,
  parseAbi,
  recoverTypedDataAddress,
} from "viem";
import { describe, expect, it } from "vitest";
import { BIG_BODY, devToolRoutes, MAX_BODY, runDevTool } from "./devtools.js";

// Parity of the blocktools 8616edd EVM exports (ABI, CREATE/CREATE2, bytecode, EIP-712) against viem,
// called through SwapChan's /tools layer. viem is the independent reference here, not a fallback.
const ok = (fn: string, i: unknown) => {
  const r = runDevTool(fn, i);
  if (!r.ok) throw new Error(`${fn}: ${r.error_code}`);
  return r.result as Record<string, unknown>;
};
const lower = (s: unknown) => String(s).toLowerCase();

// EIP-712 spec "Ether Mail" example (public vector from the EIP; no key material here)
const MAIL = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Person: [
      { name: "name", type: "string" },
      { name: "wallet", type: "address" },
    ],
    Mail: [
      { name: "from", type: "Person" },
      { name: "to", type: "Person" },
      { name: "contents", type: "string" },
    ],
  },
  primaryType: "Mail",
  domain: {
    name: "Ether Mail",
    version: "1",
    chainId: 1,
    verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
  },
  message: {
    from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" },
    to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" },
    contents: "Hello, Bob!",
  },
} as const;
const MAIL_SIG =
  "0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b915621c";
const COW = "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826";
const BOB = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";

describe("EVM dev tools (blocktools) match viem", () => {
  it("evm-abi encode / decode round-trip with viem", () => {
    const abi = parseAbi(["function transfer(address to, uint256 amount)"]);
    for (const amount of [0n, 1n, 10n ** 18n, 2n ** 256n - 1n]) {
      const want = encodeFunctionData({ abi, functionName: "transfer", args: [BOB, amount] });
      const r = ok("evm-abi", {
        op: "encode",
        sig: "transfer(address,uint256)",
        args: JSON.stringify([BOB, amount.toString()]),
      });
      expect(r.data).toBe(want);
      expect(r.selector).toBe(want.slice(0, 10));
      const d = ok("evm-abi", { op: "decode", input: want, sig: "transfer(address,uint256)" });
      expect(d.status).toBe("ok");
      const v = decodeFunctionData({ abi, data: want });
      const a = d.args as { value: unknown }[];
      expect(lower(a[0]!.value)).toBe(lower(v.args[0]));
      expect(BigInt(String(a[1]!.value))).toBe(v.args[1]);
    }
  });

  it("evm-abi inspect finds the ERC-20 interface and selectors", () => {
    const r = ok("evm-abi", {
      op: "inspect",
      abi: [
        "function totalSupply() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
        "function transfer(address,uint256) returns (bool)",
        "function allowance(address,address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
        "function transferFrom(address,address,uint256) returns (bool)",
        "event Transfer(address indexed from, address indexed to, uint256 value)",
        "event Approval(address indexed owner, address indexed spender, uint256 value)",
      ].join("\n"),
    });
    expect(r.status).toBe("ok");
    const erc20 = (r.interfaces as { interface: string; complete: boolean }[]).find(
      (x) => x.interface === "ERC-20",
    );
    expect(erc20?.complete).toBe(true);
    const t = (r.items as { signature: string; selector?: string }[]).find(
      (x) => x.signature === "transfer(address,uint256)",
    );
    expect(t?.selector).toBe(
      keccak256(new TextEncoder().encode("transfer(address,uint256)")).slice(0, 10),
    );
  });

  it("create-address CREATE and CREATE2 match viem", () => {
    for (const nonce of [0, 1, 127, 128, 255, 256, 65535, 65536, 2 ** 32]) {
      const r = ok("create-address", { deployer: COW, nonce });
      expect(r.address).toBe(getContractAddress({ from: COW, nonce: BigInt(nonce) }));
    }
    const salt = `0x${"11".repeat(32)}`;
    const code = "0x6080604052348015600f57600080fd5b50";
    const want = getContractAddress({ opcode: "CREATE2", from: COW, salt, bytecode: code });
    expect(ok("create-address", { deployer: COW, salt, init_code: code }).address).toBe(want);
    expect(
      ok("create-address", { deployer: COW, salt, init_code_hash: keccak256(code) }).address,
    ).toBe(want);
    expect(runDevTool("create-address", { deployer: COW, nonce: -1 }).ok).toBe(false);
    expect(runDevTool("create-address", { deployer: "0x12", nonce: 1 })).toMatchObject({
      ok: false,
      error_code: "bad_deployer",
    });
  });

  it("bytecode-inspect: keccak256, EIP-1167 proxy, EIP-170 edge", () => {
    const impl = "bebebebebebebebebebebebebebebebebebebebe";
    const proxy = `0x363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3`;
    const r = ok("bytecode-inspect", { code: proxy });
    expect(r.kind).toBe("eip1167_proxy");
    expect(lower(r.implementation)).toBe(`0x${impl}`);
    expect(r.keccak256).toBe(keccak256(proxy as `0x${string}`));
    expect(ok("bytecode-inspect", { code: `0x${"00".repeat(24576)}` }).exceeds_eip170).toBe(false);
    expect(ok("bytecode-inspect", { code: `0x${"00".repeat(24577)}` }).exceeds_eip170).toBe(true);
    expect(runDevTool("bytecode-inspect", { code: "0xzz" }).ok).toBe(false);
  });

  it("typed-data-verify: digest and recovered signer match viem; mismatch is reported", async () => {
    const td = JSON.stringify(MAIL);
    const r = ok("typed-data-verify", { typed_data: td, signature: MAIL_SIG, signer: COW });
    expect(r.digest).toBe(hashTypedData(MAIL));
    expect(r.recovered).toBe(await recoverTypedDataAddress({ ...MAIL, signature: MAIL_SIG }));
    expect(r.status).toBe("valid");
    expect(
      ok("typed-data-verify", { typed_data: td, signature: MAIL_SIG, signer: BOB }).status,
    ).toBe("signer_mismatch");
    expect(ok("typed-data-verify", { typed_data: td }).status).toBe("ok");
    expect(runDevTool("typed-data-verify", { typed_data: "{" })).toMatchObject({
      ok: false,
      error_code: "bad_typed_data",
    });
  });

  it("bigger body cap only for the EVM document tools", async () => {
    const app = devToolRoutes({ perMinute: 1000 });
    const post = (fn: string, body: unknown) =>
      app.request(`/${fn}`, { method: "POST", body: JSON.stringify(body) });
    const code = `0x${"60".repeat(20_000)}`;
    expect(BIG_BODY["bytecode-inspect"]).toBeGreaterThan(code.length + 100);
    expect((await post("bytecode-inspect", { code })).status).toBe(200);
    expect((await post("twox128", { text: "a".repeat(MAX_BODY) })).status).toBe(413);
    expect((await post("bytecode-inspect", { code: `0x${"60".repeat(40_000)}` })).status).toBe(413);
  });
});
