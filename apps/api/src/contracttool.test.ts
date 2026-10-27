import { describe, expect, it } from "vitest";
import {
  ALLOWED_HOSTS,
  canonicalType,
  contractRoutes,
  contractTool,
  EIP1967_IMPL_SLOT,
  eip1967Impl,
  listFunctions,
  MAX_RESPONSE_BYTES,
  parseAbi,
  safeJson,
} from "./contracttool.js";

const TOKEN = "0x1111111111111111111111111111111111111111";
const IMPL = "0x2222222222222222222222222222222222222222";
const ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "get",
    stateMutability: "view",
    inputs: [{ name: "a", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "get",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setPair",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "x", type: "uint8" },
          { name: "y", type: "bytes" },
        ],
      },
      { name: "ids", type: "uint256[]" },
    ],
    outputs: [],
  },
  { type: "event", name: "Transfer", inputs: [] },
];
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;

type Call = { url: string; init?: RequestInit };
function mockFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const host = new URL(String(url)).hostname;
    const h = routes[host];
    return h ? h() : new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const jsonRes = (v: unknown) =>
  new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });

function mockRpc(
  o: { code?: string; slot?: string; call?: (data: string) => string | Error } = {},
) {
  const seen: { method: string; params: unknown[] }[] = [];
  return {
    seen,
    rpc: () => async (method: string, params: unknown[]) => {
      seen.push({ method, params });
      if (method === "eth_getCode") return o.code ?? "0x6080";
      if (method === "eth_getStorageAt") return o.slot ?? word(0n);
      if (method === "eth_call") {
        const r = o.call ? o.call((params[0] as { data: string }).data) : word(0n);
        if (r instanceof Error) throw r;
        return r;
      }
      throw new Error("unexpected");
    },
  };
}

describe("ABI parsing", () => {
  it("expands tuples, lists functions with blocktools selectors, keeps overloads apart", () => {
    expect(
      canonicalType({ type: "tuple[]", components: [{ type: "uint8" }, { type: "bytes" }] }),
    ).toBe("(uint8,bytes)[]");
    const fns = listFunctions(parseAbi(ABI));
    const sigs = fns.map((f) => f.signature);
    expect(sigs).toEqual([
      "balanceOf(address)",
      "name()",
      "transfer(address,uint256)",
      "deposit()",
      "get(uint256)",
      "get(address)",
      "setPair((uint8,bytes),uint256[])",
    ]);
    expect(fns[0]!.selector).toBe("0x70a08231");
    expect(fns[2]!.selector).toBe("0xa9059cbb");
    expect(fns.find((f) => f.name === "deposit")!.payable).toBe(true);
    expect(fns.find((f) => f.name === "transfer")!.kind).toBe("write");
    expect(fns[0]!.kind).toBe("read");
  });
  it("accepts {abi:[...]} and JSON text, refuses junk", () => {
    expect(parseAbi(JSON.stringify({ abi: ABI }))).toHaveLength(ABI.length);
    expect(() => parseAbi("not json")).toThrow("bad_abi");
    expect(() => parseAbi([{ nope: 1 }])).toThrow("bad_abi");
    expect(() => parseAbi("x".repeat(200_001))).toThrow("abi_too_large");
  });
});

describe("safeJson (SSRF / limits)", () => {
  it("only fetches fixed https hosts, with redirects as errors", async () => {
    expect([...ALLOWED_HOSTS].sort()).toEqual(["api.etherscan.io", "sourcify.dev"]);
    const { f, calls } = mockFetch({ "sourcify.dev": () => jsonRes({ a: 1 }) });
    await expect(safeJson(f, "https://evil.example/x")).rejects.toThrow("host_not_allowed");
    await expect(safeJson(f, "http://sourcify.dev/x")).rejects.toThrow("host_not_allowed");
    await expect(safeJson(f, "https://sourcify.dev.evil.example/x")).rejects.toThrow(
      "host_not_allowed",
    );
    expect(await safeJson(f, "https://sourcify.dev/x")).toEqual({ a: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.redirect).toBe("error");
    expect(calls[0]!.init?.signal).toBeDefined();
  });
  it("caps response size even without content-length, and hides the URL on errors", async () => {
    const big = new ReadableStream({
      start(c) {
        for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(MAX_RESPONSE_BYTES / 2 + 1));
        c.close();
      },
    });
    const { f } = mockFetch({ "sourcify.dev": () => new Response(big, { status: 200 }) });
    await expect(safeJson(f, "https://sourcify.dev/x")).rejects.toThrow("upstream_too_large");
    const g = mockFetch({ "api.etherscan.io": () => new Response("x", { status: 500 }) });
    const err = await safeJson(g.f, "https://api.etherscan.io/v2/api?apikey=SECRETVALUE").catch(
      (e) => e as Error,
    );
    expect(String(err.message)).toBe("upstream_500:api.etherscan.io");
    expect(String(err.message)).not.toContain("SECRETVALUE");
  });
});

describe("proxy detection", () => {
  it("reads the EIP-1967 implementation slot", async () => {
    const { rpc, seen } = mockRpc({ slot: word(BigInt(IMPL)) });
    expect(await eip1967Impl(rpc(), TOKEN)).toBe(IMPL);
    expect(seen[0]).toEqual({
      method: "eth_getStorageAt",
      params: [TOKEN, EIP1967_IMPL_SLOT, "latest"],
    });
    expect(await eip1967Impl(mockRpc().rpc(), TOKEN)).toBeNull();
  });
  it("shows the implementation's ABI with a label, calls still target the proxy", async () => {
    const { f, calls } = mockFetch({
      "sourcify.dev": () => jsonRes({ abi: ABI, compilation: { name: "Impl" } }),
    });
    const { rpc } = mockRpc({ slot: word(BigInt(IMPL)) });
    const t = contractTool({ f, env: {}, rpc });
    const info = await t.abiInfo({ chainId: 1, address: TOKEN });
    expect(info.proxy).toEqual({ kind: "EIP-1967", implementation: IMPL });
    expect(info.abiOf).toBe(IMPL);
    expect(info.abiSource).toBe("sourcify");
    expect(info.warnings.join(" ")).toMatch(/EIP-1967 proxy/);
    expect(calls[0]!.url).toContain(`/contract/1/${IMPL}`);
    const enc = await t.encodeCall({
      chainId: 1,
      address: TOKEN,
      function: "deposit()",
      value: "5",
    });
    expect(enc.to).toBe(TOKEN);
  });
});

describe("ABI sources", () => {
  it("Sourcify first; Etherscan V2 only with a key; cached", async () => {
    const ms = mockFetch({
      "api.etherscan.io": () => jsonRes({ status: "1", result: JSON.stringify(ABI) }),
    });
    const noKey = contractTool({ f: ms.f, env: {}, rpc: mockRpc().rpc });
    const a = await noKey.abiInfo({ chainId: 1, address: TOKEN });
    expect(a.abiSource).toBeNull();
    expect(a.warnings.join(" ")).toMatch(/Paste the ABI/);
    expect(ms.calls.some((c) => c.url.includes("etherscan"))).toBe(false);

    const withKey = contractTool({ f: ms.f, env: { ETHERSCAN_API_KEY: "k" }, rpc: mockRpc().rpc });
    const b = await withKey.abiInfo({ chainId: 8453, address: TOKEN });
    expect(b.abiSource).toBe("etherscan");
    const order = ms.calls.map((c) => new URL(c.url).hostname);
    expect(order.slice(-2)).toEqual(["sourcify.dev", "api.etherscan.io"]);
    expect(ms.calls.at(-1)!.url).toContain("chainid=8453");
    const n = ms.calls.length;
    await withKey.abiInfo({ chainId: 8453, address: TOKEN });
    expect(ms.calls.length).toBe(n);
  });
  it("pasted ABI is labelled and no third party is called", async () => {
    const ms = mockFetch({});
    const t = contractTool({ f: ms.f, env: {}, rpc: mockRpc().rpc });
    const i = await t.abiInfo({ chainId: "ethereum", address: TOKEN, abi: JSON.stringify(ABI) });
    expect(i.abiSource).toBe("pasted");
    expect(i.warnings.join(" ")).toMatch(/pasted/);
    expect(ms.calls).toHaveLength(0);
  });
  it("validates chain and address; EVM only", async () => {
    const t = contractTool({ f: mockFetch({}).f, env: {}, rpc: mockRpc().rpc });
    await expect(t.abiInfo({ chainId: 1, address: "0x12" })).rejects.toThrow("bad_address");
    await expect(t.abiInfo({ chainId: "solana", address: TOKEN })).rejects.toThrow(
      "not_an_evm_chain",
    );
    await expect(t.abiInfo({ chainId: 999999, address: TOKEN })).rejects.toThrow(
      "unsupported_chain",
    );
  });
});

describe("read and encode", () => {
  const paste = { chainId: 1, address: TOKEN, abi: JSON.stringify(ABI) };
  it("encodes args with blocktools, runs eth_call, decodes the result", async () => {
    const { rpc, seen } = mockRpc({ call: () => word(1234n) });
    const t = contractTool({ f: mockFetch({}).f, env: {}, rpc });
    const r = await t.read({ ...paste, function: "balanceOf", args: [IMPL] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calldata).toBe(`0x70a08231${"0".repeat(24)}${IMPL.slice(2)}`);
    expect(r.result).toEqual([{ name: "out0", type: "uint256", value: "1234" }]);
    const call = seen.find((s) => s.method === "eth_call")!;
    expect(call.params[0]).toEqual({ to: TOKEN, data: r.calldata });
  });
  it("a failed read is an error, never a zero", async () => {
    const t1 = contractTool({
      f: mockFetch({}).f,
      env: {},
      rpc: mockRpc({ call: () => new Error("execution reverted") }).rpc,
    });
    expect(await t1.read({ ...paste, function: "name" })).toMatchObject({
      ok: false,
      error_code: "call_reverted",
    });
    const t2 = contractTool({
      f: mockFetch({}).f,
      env: {},
      rpc: mockRpc({ call: () => "0x" }).rpc,
    });
    expect(await t2.read({ ...paste, function: "name" })).toMatchObject({
      ok: false,
      error_code: "empty_result",
    });
  });
  it("overloads need an explicit signature; writes are not readable", async () => {
    const t = contractTool({
      f: mockFetch({}).f,
      env: {},
      rpc: mockRpc({ call: () => word(7n) }).rpc,
    });
    await expect(t.read({ ...paste, function: "get", args: ["1"] })).rejects.toThrow(
      "overloaded_function_use_signature",
    );
    expect(await t.read({ ...paste, function: "get(uint256)", args: ["1"] })).toMatchObject({
      ok: true,
    });
    await expect(t.read({ ...paste, function: "transfer", args: [IMPL, "1"] })).rejects.toThrow(
      "not_a_read_function",
    );
    await expect(t.read({ ...paste, function: "balanceOf", args: [] })).rejects.toThrow(
      "wrong_arg_count",
    );
    await expect(
      t.read({ ...paste, function: "balanceOf", args: ["x".repeat(9000)] }),
    ).rejects.toThrow(/too_large/);
  });
  it("builds unsigned calldata with a decoded view; value only for payable", async () => {
    const t = contractTool({ f: mockFetch({}).f, env: {}, rpc: mockRpc().rpc });
    const e = await t.encodeCall({ ...paste, function: "transfer", args: [IMPL, "1000"] });
    expect(e.data.slice(0, 10)).toBe("0xa9059cbb");
    expect(e.decoded.signature).toBe("transfer(address,uint256)");
    expect(e.value).toBe("0");
    expect(e.note).toMatch(/never signs/);
    await expect(
      t.encodeCall({ ...paste, function: "transfer", args: [IMPL, "1"], value: "1" }),
    ).rejects.toThrow("value_on_non_payable");
    expect((await t.encodeCall({ ...paste, function: "deposit", value: "10" })).value).toBe("10");
    const tup = await t.encodeCall({
      ...paste,
      function: "setPair",
      args: ['[1,"0x12"]', "[1,2]"],
    });
    expect(tup.function).toBe("setPair((uint8,bytes),uint256[])");
  });
});

describe("routes", () => {
  it("rate-limits per client and caps the body", async () => {
    const app = contractRoutes(
      { f: mockFetch({}).f, env: {}, rpc: mockRpc().rpc },
      { perMinute: 2 },
    );
    const hit = () =>
      app.request(`/abi?chainId=1&address=${TOKEN}`, { headers: { "x-forwarded-for": "9.9.9.9" } });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const r = await hit();
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ ok: false, error_code: "rate_limited" });
    const app2 = contractRoutes({ f: mockFetch({}).f, env: {}, rpc: mockRpc().rpc });
    const big = await app2.request("/read", { method: "POST", body: "x".repeat(260_000) });
    expect(big.status).toBe(413);
    const bj = await app2.request("/read", { method: "POST", body: "nope" });
    expect(await bj.json()).toMatchObject({ ok: false, error_code: "bad_json" });
  });
});
