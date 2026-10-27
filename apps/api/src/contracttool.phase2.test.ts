import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { blocktools } from "./blocktools.js";
import {
  contractRoutes,
  contractTool,
  detectSlotProxy,
  EIP1822_PROXIABLE_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPL_SLOT,
  IMPLEMENTATION_SELECTOR,
  MAX_INITCODE_BYTES,
  ZEPPELINOS_IMPL_SLOT,
} from "./contracttool.js";

const A = "0x1111111111111111111111111111111111111111";
const IMPL = "0x2222222222222222222222222222222222222222";
const BEACON = "0x3333333333333333333333333333333333333333";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDC_IMPL = "0x43506849d7c04f9138d1a2050bbf3a0c054402dd";
const USDC_IMPL_CS = getAddress(USDC_IMPL);
const DEPLOYER = "0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0";
const word = (h: string) => `0x${h.replace(/^0x/, "").padStart(64, "0")}`;
const hexOf = (s: string) => `0x${Buffer.from(s, "utf8").toString("hex")}`;
const keccak = (s: string) => blocktools()!.evmKeccak256(hexOf(s));
const minus1 = (h: string) => word((BigInt(h) - 1n).toString(16));

const fn = (
  name: string,
  sm: string,
  inputs: { name: string; type: string }[] = [],
  outputs: { name: string; type: string }[] = [],
) => ({ type: "function", name, stateMutability: sm, inputs, outputs });
const TOKEN_ABI = [
  fn(
    "transfer",
    "nonpayable",
    [
      { name: "to", type: "address" },
      { name: "v", type: "uint256" },
    ],
    [{ name: "", type: "bool" }],
  ),
  fn("setX", "nonpayable", [{ name: "x", type: "uint256" }]),
  fn("deposit", "payable"),
  fn("balanceOf", "view", [{ name: "o", type: "address" }], [{ name: "", type: "uint256" }]),
];
const PROXY_ABI = [
  fn("implementation", "view", [], [{ name: "", type: "address" }]),
  fn("upgradeTo", "nonpayable", [{ name: "i", type: "address" }]),
];

type Net = {
  code?: Record<string, string>;
  slots?: Record<string, Record<string, string>>;
  calls?: Record<string, Record<string, string>>;
  nonce?: string | Error;
};
function net(n: Net) {
  const seen: { method: string; params: unknown[] }[] = [];
  const rpc = () => async (method: string, params: unknown[]) => {
    seen.push({ method, params });
    const a = String((params[0] as { to?: string })?.to ?? params[0]).toLowerCase();
    if (method === "eth_getCode") return n.code?.[a] ?? "0x";
    if (method === "eth_getStorageAt") return n.slots?.[a]?.[String(params[1])] ?? word("0");
    if (method === "eth_call") return n.calls?.[a]?.[(params[0] as { data: string }).data] ?? "0x";
    if (method === "eth_getTransactionCount") {
      if (n.nonce instanceof Error) throw n.nonce;
      return n.nonce ?? "0x0";
    }
    throw new Error("unexpected");
  };
  return { rpc, seen };
}
function sourcify(abis: Record<string, unknown[]>) {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(String(url));
    const m = /\/contract\/\d+\/(0x[0-9a-f]{40})/.exec(String(url));
    const abi = m ? abis[m[1]!] : undefined;
    return abi
      ? new Response(JSON.stringify({ abi, compilation: { name: "X" } }), { status: 200 })
      : new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, urls };
}

describe("proxy slot constants (checked against blocktools evmKeccak256)", () => {
  it("match their defining strings", () => {
    expect(minus1(keccak("eip1967.proxy.implementation"))).toBe(EIP1967_IMPL_SLOT);
    expect(minus1(keccak("eip1967.proxy.beacon"))).toBe(EIP1967_BEACON_SLOT);
    expect(keccak("org.zeppelinos.proxy.implementation")).toBe(ZEPPELINOS_IMPL_SLOT);
    expect(keccak("PROXIABLE")).toBe(EIP1822_PROXIABLE_SLOT);
    expect(JSON.parse(blocktools()!.evmSigHash("implementation()")).selector).toBe(
      IMPLEMENTATION_SELECTOR,
    );
  });
});

describe("proxy kinds", () => {
  it("EIP-1822, beacon, and an empty beacon falls through", async () => {
    const uups = net({ slots: { [A]: { [EIP1822_PROXIABLE_SLOT]: word(IMPL) } } });
    expect(await detectSlotProxy(uups.rpc(), A)).toEqual({
      kind: "EIP-1822",
      implementation: IMPL,
    });
    const b = net({
      slots: { [A]: { [EIP1967_BEACON_SLOT]: word(BEACON) } },
      calls: { [BEACON]: { [IMPLEMENTATION_SELECTOR]: word(IMPL) } },
    });
    expect(await detectSlotProxy(b.rpc(), A)).toEqual({
      kind: "EIP-1967 beacon",
      implementation: IMPL,
      beacon: BEACON,
    });
    const dead = net({ slots: { [A]: { [EIP1967_BEACON_SLOT]: word(BEACON) } } });
    expect(await detectSlotProxy(dead.rpc(), A)).toBeNull();
  });
  it("USDC FiatTokenProxy layout (OpenZeppelin legacy slot) resolves to the implementation ABI", async () => {
    const { rpc } = net({
      code: { [USDC]: "0x6080", [USDC_IMPL]: "0x6080" },
      slots: { [USDC]: { [ZEPPELINOS_IMPL_SLOT]: word(USDC_IMPL) } },
    });
    const { f, urls } = sourcify({ [USDC]: PROXY_ABI, [USDC_IMPL]: TOKEN_ABI });
    const info = await contractTool({ f, env: {}, rpc }).abiInfo({ chainId: 1, address: USDC });
    // EIP-55 checksummed for display, never lowercase
    expect(info.proxy).toEqual({ kind: "OpenZeppelin legacy", implementation: USDC_IMPL_CS });
    expect(info.abiOf).toBe(USDC_IMPL_CS);
    expect(info.warnings.join(" ")).toContain(`(${USDC_IMPL_CS})`);
    expect(info.warnings.join(" ")).not.toContain(USDC_IMPL);
    expect(info.functions.map((x) => x.name)).toContain("transfer");
    expect(info.warnings.join(" ")).toMatch(/proxy \(OpenZeppelin legacy\)/);
    expect(urls[0]).toContain(USDC_IMPL);
    // /contract-tool/encode carries the same checksummed implementation; `to` stays the raw proxy address
    const enc = await contractTool({ f, env: {}, rpc }).encodeCall({
      chainId: 1,
      address: USDC,
      function: "setX",
      args: ["1"],
    });
    expect(enc.proxy).toEqual({ kind: "OpenZeppelin legacy", implementation: USDC_IMPL_CS });
    expect(enc.to).toBe(USDC);
  });
  it("EIP-897 fallback only when no slot matched and the ABI has implementation(); never for a pasted ABI", async () => {
    const n = net({
      code: { [A]: "0x6080", [IMPL]: "0x6080" },
      calls: { [A]: { [IMPLEMENTATION_SELECTOR]: word(IMPL) } },
    });
    const { f } = sourcify({ [A]: PROXY_ABI, [IMPL]: TOKEN_ABI });
    const info = await contractTool({ f, env: {}, rpc: n.rpc }).abiInfo({ chainId: 1, address: A });
    expect(info.proxy).toEqual({ kind: "EIP-897", implementation: IMPL });
    expect(info.abiOf).toBe(IMPL);
    const p = net({
      code: { [A]: "0x6080", [IMPL]: "0x6080" },
      calls: { [A]: { [IMPLEMENTATION_SELECTOR]: word(IMPL) } },
    });
    const pasted = await contractTool({ f, env: {}, rpc: p.rpc }).abiInfo({
      chainId: 1,
      address: A,
      abi: TOKEN_ABI,
    });
    expect(pasted.proxy).toBeNull();
    expect(p.seen.some((s) => s.method === "eth_call")).toBe(false);
    // own ABI without implementation(): no probe
    const q = net({
      code: { [A]: "0x6080", [IMPL]: "0x6080" },
      calls: { [A]: { [IMPLEMENTATION_SELECTOR]: word(IMPL) } },
    });
    const plain = await contractTool({
      f: sourcify({ [A]: TOKEN_ABI }).f,
      env: {},
      rpc: q.rpc,
    }).abiInfo({ chainId: 1, address: A });
    expect(plain.proxy).toBeNull();
    expect(q.seen.some((s) => s.method === "eth_call")).toBe(false);
    // implementation() pointing at an address without code is ignored
    const r = net({
      code: { [A]: "0x6080" },
      calls: { [A]: { [IMPLEMENTATION_SELECTOR]: word(IMPL) } },
    });
    expect(
      (await contractTool({ f, env: {}, rpc: r.rpc }).abiInfo({ chainId: 1, address: A })).proxy,
    ).toBeNull();
  });
});

const paste = { chainId: 1, address: A, abi: JSON.stringify(TOKEN_ABI) };
const tool = (n: Net = { code: { [A]: "0x6080" } }) =>
  contractTool({ f: sourcify({}).f, env: {}, rpc: net(n).rpc });

describe("pre-signing verdict (approveCall)", () => {
  it("passes a well-formed call, on mainnet and Base, with blocktools' checks shown", async () => {
    for (const chainId of [1, 8453]) {
      const v = await tool().approveCall({ ...paste, chainId, function: "setX", args: ["9"] });
      expect(v.verdict).toBe("pass");
      expect(v.reasons).toEqual([]);
      expect(v.approve).toMatchObject({ status: "ok", signature: "setX(uint256)", kind: "call" });
      expect(v.verify?.ok).toBe(true);
      expect(v.verify?.check_these).toMatch(/CHECK THESE/);
      expect(v.data.slice(0, 10)).toBe(v.selector);
      expect(v.to).toBe(A);
      expect(v.note).toMatch(/never signs/);
    }
    const t = await tool().approveCall({ ...paste, function: "transfer", args: [IMPL, "5"] });
    expect(t.reasons).toEqual([]);
    const d = await tool().approveCall({ ...paste, function: "deposit", value: "7" });
    expect([d.verdict, d.value]).toEqual(["pass", "7"]);
  });
  it("refuses value on a non-payable function and bad args before any verdict", async () => {
    await expect(
      tool().approveCall({ ...paste, function: "setX", args: ["1"], value: "1" }),
    ).rejects.toThrow("value_on_non_payable");
    await expect(tool().approveCall({ ...paste, function: "setX", args: [] })).rejects.toThrow(
      "wrong_arg_count",
    );
  });
});

const INIT = "0x6080604052348015600f57600080fd5b50";
describe("contract creation (buildCreation)", () => {
  it("builds initcode, reports its keccak, approves against it, predicts the address", async () => {
    const c = await tool({ nonce: "0x1" }).buildCreation({
      chainId: 1,
      bytecode: INIT,
      from: DEPLOYER,
    });
    expect(c.verdict).toBe("pass");
    expect(c.to).toBeNull();
    expect(c.data).toBe(INIT);
    expect(c.initcode_keccak256).toBe(blocktools()!.evmKeccak256(INIT));
    expect(c.createHash).toBe(c.initcode_keccak256);
    expect(c.approve).toMatchObject({ kind: "create", status: "ok" });
    expect(c.predicted).toEqual({
      address: "0x343c43A37D37dfF08AE8C4A11544c718AbB4fCF8",
      deployer: DEPLOYER,
      nonce: "1",
    });
    expect(c.value).toBe("0");
    expect(c.warnings.join(" ")).toMatch(/irreversible/);
    expect(c.warnings.join(" ")).toMatch(/not verified/);
    expect(c.warnings.join(" ")).toMatch(/no native coin/);
  });
  it("appends constructor args; value only for a payable constructor", async () => {
    const abi = [
      {
        type: "constructor",
        stateMutability: "payable",
        inputs: [
          { name: "n", type: "uint256" },
          { name: "o", type: "address" },
        ],
      },
    ];
    const c = await tool().buildCreation({
      chainId: 8453,
      bytecode: INIT,
      abi,
      args: ["5", IMPL],
      value: "1000000000000000000",
    });
    expect(c.data).toBe(`${INIT}${word("5").slice(2)}${word(IMPL).slice(2)}`);
    expect([c.reasons, c.value, c.predicted]).toEqual([[], "1000000000000000000", null]);
    expect(c.warnings.join(" ")).toMatch(/1000000000000000000 wei/);
    const np = [{ type: "constructor", stateMutability: "nonpayable", inputs: [] }];
    await expect(
      tool().buildCreation({ chainId: 1, bytecode: INIT, abi: np, value: "1" }),
    ).rejects.toThrow("value_on_non_payable");
    await expect(tool().buildCreation({ chainId: 1, bytecode: INIT, value: "1" })).rejects.toThrow(
      "value_needs_constructor_abi",
    );
    await expect(
      tool().buildCreation({ chainId: 1, bytecode: INIT, abi, args: [] }),
    ).rejects.toThrow("wrong_arg_count");
  });
  it("a pinned createHash that does not match fails the verdict", async () => {
    const c = await tool().buildCreation({
      chainId: 1,
      bytecode: INIT,
      createHash: `0x${"11".repeat(32)}`,
    });
    expect(c.verdict).toBe("fail");
    expect(c.reasons).toContain("approve_initcode_mismatch");
  });
  it("limits and validation; nonce failure means no prediction, not a guess", async () => {
    await expect(
      tool().buildCreation({ chainId: 1, bytecode: `0x${"00".repeat(MAX_INITCODE_BYTES + 1)}` }),
    ).rejects.toThrow("initcode_too_large");
    expect(
      (await tool().buildCreation({ chainId: 1, bytecode: `0x${"00".repeat(MAX_INITCODE_BYTES)}` }))
        .initcode_bytes,
    ).toBe(MAX_INITCODE_BYTES);
    await expect(tool().buildCreation({ chainId: 1, bytecode: "0xzz" })).rejects.toThrow(
      "bad_bytecode",
    );
    await expect(tool().buildCreation({ chainId: 1, bytecode: "0x123" })).rejects.toThrow(
      "bad_bytecode",
    );
    await expect(tool().buildCreation({ chainId: 1, bytecode: "" })).rejects.toThrow(
      "missing_bytecode",
    );
    await expect(
      tool().buildCreation({ chainId: 1, bytecode: INIT, from: "nope" }),
    ).rejects.toThrow("bad_from");
    const c = await tool({ nonce: new Error("down") }).buildCreation({
      chainId: 1,
      bytecode: INIT,
      from: DEPLOYER,
    });
    expect(c.predicted).toBeNull();
    expect(c.warnings.join(" ")).toMatch(/no predicted address/);
  });
});

describe("creation nonce read (predicted address)", () => {
  it("only eth_getTransactionCount on the validated from address; nothing without from", async () => {
    const n = net({ nonce: "0x1" });
    const t = contractTool({ f: sourcify({}).f, env: {}, rpc: n.rpc });
    await t.buildCreation({
      chainId: 1,
      bytecode: INIT,
      from: ` ${DEPLOYER.toUpperCase().replace("0X", "0x")} `,
    });
    expect(n.seen).toEqual([{ method: "eth_getTransactionCount", params: [DEPLOYER, "pending"] }]);
    const none = net({ nonce: "0x1" });
    await contractTool({ f: sourcify({}).f, env: {}, rpc: none.rpc }).buildCreation({
      chainId: 1,
      bytecode: INIT,
    });
    expect(none.seen).toEqual([]);
    for (const bad of [
      `${DEPLOYER}00`,
      DEPLOYER.slice(0, 41),
      `0x${"g".repeat(40)}`,
      "vitalik.eth",
      1,
    ]) {
      const b = net({ nonce: "0x1" });
      await expect(
        contractTool({ f: sourcify({}).f, env: {}, rpc: b.rpc }).buildCreation({
          chainId: 1,
          bytecode: INIT,
          from: bad,
        }),
      ).rejects.toThrow("bad_from");
      expect(b.seen).toEqual([]);
    }
  });
  it("/create is behind the per-client rate limit", async () => {
    const app = contractRoutes(
      { f: sourcify({}).f, env: {}, rpc: net({ nonce: "0x1" }).rpc },
      { perMinute: 2 },
    );
    const req = (h: Record<string, string> = {}) =>
      app.request("/create", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ chainId: 1, bytecode: INIT, from: DEPLOYER }),
      });
    expect((await req()).status).toBe(200);
    expect((await req({ "x-forwarded-for": "10.0.0.1" })).status).toBe(200);
    expect((await req({ "x-forwarded-for": "10.0.0.2" })).status).toBe(429);
  });
});

describe("routes /approve and /create", () => {
  it("serve JSON, keep the body cap", async () => {
    const app = contractRoutes({
      f: sourcify({}).f,
      env: {},
      rpc: net({ code: { [A]: "0x6080" } }).rpc,
    });
    const r = await app.request("/approve", {
      method: "POST",
      body: JSON.stringify({ ...paste, function: "setX", args: ["1"] }),
    });
    expect(await r.json()).toMatchObject({ ok: true, verdict: "pass" });
    const c = await app.request("/create", {
      method: "POST",
      body: JSON.stringify({ chainId: 1, bytecode: INIT }),
    });
    expect(await c.json()).toMatchObject({ ok: true, verdict: "pass", to: null });
    const big = await app.request("/create", { method: "POST", body: "x".repeat(260_000) });
    expect(big.status).toBe(413);
  });
});
