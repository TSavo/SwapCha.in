/**
 * Read / Write Contract (swapchan.com/tools/contract, MCP contract_abi / contract_read / contract_encode_call).
 * EVM only. Fetches a contract's ABI (Sourcify first, then Etherscan API V2 only when ETHERSCAN_API_KEY is set, else a
 * pasted ABI), follows EIP-1967 proxies, runs view/pure functions through eth_call on the existing RPC layer, and
 * builds calldata for write functions. All ABI parsing, encoding and decoding runs in blocktools (evmAbiInspect,
 * evmAbiEncode, evmAbiDecode). Nothing here signs, sends or broadcasts: the user's own wallet does that.
 *
 * Safety: fixed hosts only (sourcify.dev, api.etherscan.io), redirects are errors, response size and time capped,
 * request bodies capped, per-client fixed-window rate limit, a small cap on concurrent reads, the API key is never
 * logged or echoed (errors carry a host and status only). Failed reads return an error, never a zero.
 */
import { Hono } from "hono";
import { blocktools } from "./blocktools.js";
import { socketAddressOf } from "./clientip.js";
import { clientOf } from "./devtools.js";
import { chainName, chainOf, EVM_IDS, evmClient } from "./onchain.js";

type F = typeof fetch;
type Rpc = (method: string, params: unknown[]) => Promise<unknown>;
export type AbiParam = { name?: string; type: string; components?: AbiParam[]; indexed?: boolean };
export type AbiItem = {
  type: string;
  name?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: string;
};
export type ContractFn = {
  name: string;
  signature: string;
  selector: string;
  stateMutability: string;
  kind: "read" | "write";
  payable: boolean;
  inputs: { name: string; type: string; components?: AbiParam[] }[];
  outputs: { name: string; type: string; components?: AbiParam[] }[];
};

export const ALLOWED_HOSTS = new Set(["sourcify.dev", "api.etherscan.io"]);
export const MAX_RESPONSE_BYTES = 2_000_000;
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_ABI_CHARS = 200_000;
export const MAX_BODY = 250_000;
export const MAX_ARGS = 32;
export const MAX_ARG_CHARS = 8_192;
export const MAX_CONCURRENT_READS = 8;
export const RATE_PER_MIN = 30;
export const CACHE_TTL_MS = 60 * 60_000;
export const MISS_TTL_MS = 5 * 60_000;
const CACHE_MAX = 1_000;
/** EIP-1967 implementation slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1). */
export const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const SIG = /^[A-Za-z_$][A-Za-z0-9_$]*\([A-Za-z0-9_,()[\]]*\)$/;

export class ContractError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const bad = (code: string, status = 400): never => {
  throw new ContractError(code, status);
};
const w = () => blocktools() ?? bad("blocktools_unavailable", 503);

export function evmChain(v: unknown): number {
  if (typeof v !== "string" && typeof v !== "number") return bad("missing_chainId");
  let id: number;
  try {
    id = chainOf(v);
  } catch {
    return bad("unsupported_chain");
  }
  return EVM_IDS.includes(id) ? id : bad("not_an_evm_chain");
}
export const needAddress = (v: unknown, k = "address"): string =>
  typeof v === "string" && ADDR.test(v.trim()) ? v.trim().toLowerCase() : bad(`bad_${k}`);

/**
 * GET a JSON document from a fixed host. Redirects are errors, the body is read with a byte cap, the whole call has a
 * timeout. Error text names the host and status only (the URL may carry an API key).
 */
export async function safeJson(
  f: F,
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) bad("host_not_allowed");
  const max = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  let r: Response;
  try {
    r = await f(url, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
  } catch {
    return bad(`fetch_failed:${u.hostname}`, 502);
  }
  if (r.status === 404) return null;
  if (!r.ok) return bad(`upstream_${r.status}:${u.hostname}`, 502);
  if (Number(r.headers.get("content-length") ?? 0) > max) bad("upstream_too_large", 502);
  const reader = r.body?.getReader();
  if (!reader) return bad("upstream_empty", 502);
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return bad("upstream_too_large", 502);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as unknown;
  } catch {
    return bad("upstream_bad_json", 502);
  }
}

/** Validates ABI JSON (array of items, or {abi:[...]}) and returns the item list. */
export function parseAbi(v: unknown): AbiItem[] {
  let x = v;
  if (typeof x === "string") {
    if (x.length > MAX_ABI_CHARS) bad("abi_too_large");
    try {
      x = JSON.parse(x);
    } catch {
      return bad("bad_abi");
    }
  }
  if (
    x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Array.isArray((x as { abi?: unknown }).abi)
  )
    x = (x as { abi: unknown }).abi;
  if (!Array.isArray(x) || x.length > 2_000) return bad("bad_abi");
  for (const i of x) if (!i || typeof i !== "object" || typeof i.type !== "string") bad("bad_abi");
  return x as AbiItem[];
}

/** Canonical Solidity type string of one ABI parameter (tuples expanded). String formatting only, no hashing. */
export function canonicalType(p: AbiParam): string {
  if (p.type.startsWith("tuple")) {
    const suffix = p.type.slice("tuple".length);
    return `(${(p.components ?? []).map(canonicalType).join(",")})${suffix}`;
  }
  return p.type;
}
const params = (ps: AbiParam[] | undefined, pre = "arg") =>
  (ps ?? []).map((p, i) => ({
    name: p.name || `${pre}${i}`,
    type: canonicalType(p),
    ...(p.components ? { components: p.components } : {}),
  }));

/** Every function in the ABI, with blocktools' selector and signature. Overloads are distinct by signature. */
export function listFunctions(abi: AbiItem[]): ContractFn[] {
  const fns = abi.filter((i) => i.type === "function" && i.name);
  if (!fns.length) return [];
  const insp = JSON.parse(w().evmAbiInspect(JSON.stringify(fns))) as {
    status?: string;
    items?: { kind: string; signature: string; selector: string }[];
  };
  if (insp.status !== "ok") bad("bad_abi");
  const sel = new Map(
    (insp.items ?? []).filter((i) => i.kind === "function").map((i) => [i.signature, i.selector]),
  );
  const out: ContractFn[] = [];
  for (const f of fns) {
    const inputs = params(f.inputs);
    const signature = `${f.name}(${inputs.map((p) => p.type).join(",")})`;
    const selector = sel.get(signature);
    if (!selector) continue;
    const sm = f.stateMutability ?? "nonpayable";
    out.push({
      name: f.name!,
      signature,
      selector,
      stateMutability: sm,
      kind: sm === "view" || sm === "pure" ? "read" : "write",
      payable: sm === "payable",
      inputs,
      outputs: params(f.outputs, "out"),
    });
  }
  return out;
}

export type AbiSource = "sourcify" | "etherscan" | "pasted";
export type AbiInfo = {
  chainId: number;
  chain: string;
  address: string;
  isContract: boolean;
  proxy: { kind: "EIP-1967"; implementation: string } | null;
  abiSource: AbiSource | null;
  abiOf: string | null;
  verifiedName: string | null;
  warnings: string[];
  functions: ContractFn[];
  abi: AbiItem[] | null;
};

async function sourcifyAbi(f: F, chainId: number, a: string) {
  const j = (await safeJson(
    f,
    `https://sourcify.dev/server/v2/contract/${chainId}/${a}?fields=abi,compilation`,
  )) as {
    abi?: unknown;
    compilation?: { name?: string };
  } | null;
  if (!j || !Array.isArray(j.abi)) return null;
  return { abi: parseAbi(j.abi), name: j.compilation?.name ?? null };
}
async function etherscanAbi(f: F, env: NodeJS.ProcessEnv, chainId: number, a: string) {
  const key = env.ETHERSCAN_API_KEY;
  if (!key) return null;
  const q = new URLSearchParams({
    chainid: String(chainId),
    module: "contract",
    action: "getabi",
    address: a,
    apikey: key,
  });
  const j = (await safeJson(f, `https://api.etherscan.io/v2/api?${q}`)) as {
    status?: string;
    result?: unknown;
  } | null;
  if (!j || j.status !== "1" || typeof j.result !== "string") return null;
  return { abi: parseAbi(j.result), name: null };
}
/** Sourcify, then Etherscan V2 (key only). Upstream failures fall through to the next source. */
async function fetchAbi(f: F, env: NodeJS.ProcessEnv, chainId: number, a: string) {
  const s = await sourcifyAbi(f, chainId, a).catch(() => null);
  if (s) return { ...s, source: "sourcify" as const };
  const e = await etherscanAbi(f, env, chainId, a).catch(() => null);
  if (e) return { ...e, source: "etherscan" as const };
  return null;
}

/** EIP-1967 implementation address from the proxy slot, or null. */
export async function eip1967Impl(rpc: Rpc, a: string): Promise<string | null> {
  const v = String(await rpc("eth_getStorageAt", [a, EIP1967_IMPL_SLOT, "latest"]));
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(v) || BigInt(v) === 0n) return null;
  const hex = v.slice(2).padStart(64, "0");
  if (!/^0{24}/.test(hex)) return null;
  return `0x${hex.slice(24)}`;
}

export function rpcOf(chainId: number, env: NodeJS.ProcessEnv): Rpc {
  const c = evmClient(chainId, env);
  const ok = new Set(["eth_call", "eth_getStorageAt", "eth_getCode"]);
  return (method, p) => {
    if (!ok.has(method)) return bad("not_a_read_method");
    return (c.request as (a: { method: string; params: unknown[] }) => Promise<unknown>)({
      method,
      params: p,
    });
  };
}

type CacheEntry = { at: number; ttl: number; v: Awaited<ReturnType<typeof fetchAbi>> };
export type Deps = {
  f: F;
  env: NodeJS.ProcessEnv;
  rpc?: (chainId: number) => Rpc;
  now?: () => number;
};

export function contractTool(d: Deps) {
  const now = d.now ?? Date.now;
  const rpc = d.rpc ?? ((id: number) => rpcOf(id, d.env));
  const cache = new Map<string, CacheEntry>();
  let inFlight = 0;
  const cached = async (chainId: number, a: string) => {
    const k = `${chainId}:${a}`;
    const hit = cache.get(k);
    if (hit && now() - hit.at < hit.ttl) return hit.v;
    const v = await fetchAbi(d.f, d.env, chainId, a);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(k, { at: now(), ttl: v ? CACHE_TTL_MS : MISS_TTL_MS, v });
    return v;
  };

  async function abiInfo(i: {
    chainId: unknown;
    address: unknown;
    abi?: unknown;
  }): Promise<AbiInfo> {
    const chainId = evmChain(i.chainId);
    const address = needAddress(i.address);
    const r = rpc(chainId);
    const code = String(
      await r("eth_getCode", [address, "latest"]).catch(() => bad("rpc_failed", 502)),
    );
    const isContract = code !== "0x" && code !== "";
    const impl = isContract ? await eip1967Impl(r, address).catch(() => null) : null;
    const warnings: string[] = [];
    if (!isContract) warnings.push("No contract code at this address on this chain.");
    let abi: AbiItem[] | null = null;
    let source: AbiSource | null = null;
    let abiOf: string | null = null;
    let name: string | null = null;
    if (i.abi !== undefined && i.abi !== null && i.abi !== "") {
      abi = parseAbi(i.abi);
      source = "pasted";
      abiOf = address;
      warnings.push(
        "You pasted this ABI. SwapChan did not check it against the contract's source.",
      );
    } else {
      const implGot = impl ? await cached(chainId, impl) : null;
      const got = implGot ?? (isContract ? await cached(chainId, address) : null);
      if (got) {
        abi = got.abi;
        source = got.source;
        name = got.name;
        abiOf = implGot ? impl : address;
        warnings.push(
          `ABI from ${source === "sourcify" ? "Sourcify" : "Etherscan"}, a third party. SwapChan does not audit the contract; check it before you send anything.`,
        );
      } else if (isContract)
        warnings.push(
          "No verified ABI found on Sourcify or Etherscan. Paste the ABI to use this contract.",
        );
    }
    if (impl)
      warnings.push(
        `This is an EIP-1967 proxy. Functions shown are the implementation's (${impl}); calls go to the proxy address, and the owner can change the implementation.`,
      );
    return {
      chainId,
      chain: chainName(chainId),
      address,
      isContract,
      proxy: impl ? { kind: "EIP-1967", implementation: impl } : null,
      abiSource: source,
      abiOf,
      verifiedName: name,
      warnings,
      functions: abi ? listFunctions(abi) : [],
      abi,
    };
  }

  const pickFn = (fns: ContractFn[], sel: unknown): ContractFn => {
    if (typeof sel !== "string" || !sel.trim() || sel.length > 512) return bad("missing_function");
    const s = sel.replace(/\s+/g, "");
    if (SIG.test(s)) return fns.find((f) => f.signature === s) ?? bad("function_not_in_abi");
    const byName = fns.filter((f) => f.name === s);
    if (byName.length > 1) bad("overloaded_function_use_signature");
    return byName[0] ?? bad("function_not_in_abi");
  };

  /** Arguments as a list; each string is passed as typed, JSON for arrays/tuples, true/false for bool. */
  const shapeArgs = (fn: ContractFn, v: unknown): unknown[] => {
    let a = v ?? [];
    if (typeof a === "string") {
      try {
        a = a.trim() ? JSON.parse(a) : [];
      } catch {
        return bad("bad_args");
      }
    }
    if (!Array.isArray(a) || a.length > MAX_ARGS) return bad("bad_args");
    if (a.length !== fn.inputs.length) bad("wrong_arg_count");
    if (JSON.stringify(a).length > MAX_ARG_CHARS * 4) bad("args_too_large");
    return a.map((x, k) => {
      const t = fn.inputs[k]!.type;
      if (typeof x === "string") {
        if (x.length > MAX_ARG_CHARS) bad("arg_too_large");
        const s = x.trim();
        if (t === "bool") return s === "true" ? true : s === "false" ? false : bad(`bad_arg_${k}`);
        if (t.endsWith("]") || t.startsWith("(")) {
          try {
            return JSON.parse(s);
          } catch {
            return bad(`bad_arg_${k}`);
          }
        }
        return s;
      }
      return x;
    });
  };

  const encode = (fn: ContractFn, args: unknown[]) => {
    const e = JSON.parse(w().evmAbiEncode(JSON.stringify({ sig: fn.signature, args }))) as {
      status?: string;
      data?: string;
      error?: string;
    };
    if (e.status !== "ok" || !e.data) bad("encode_failed");
    return e.data!;
  };

  const resolve = async (i: Record<string, unknown>) => {
    const info = await abiInfo({ chainId: i.chainId, address: i.address, abi: i.abi });
    if (!info.abi) bad("no_abi", 404);
    return info;
  };

  async function read(i: Record<string, unknown>) {
    const info = await resolve(i);
    const fn = pickFn(info.functions, i.function ?? i.signature);
    if (fn.kind !== "read") bad("not_a_read_function");
    const data = encode(fn, shapeArgs(fn, i.args));
    if (inFlight >= MAX_CONCURRENT_READS) bad("busy_try_again", 503);
    inFlight++;
    let raw: string;
    try {
      raw = String(await rpc(info.chainId)("eth_call", [{ to: info.address, data }, "latest"]));
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      return {
        ok: false as const,
        error_code: /revert/i.test(m) ? "call_reverted" : "rpc_failed",
        function: fn.signature,
        calldata: data,
      };
    } finally {
      inFlight--;
    }
    if (!/^0x[0-9a-fA-F]*$/.test(raw))
      return {
        ok: false as const,
        error_code: "bad_rpc_result",
        function: fn.signature,
        calldata: data,
      };
    if (raw === "0x" && fn.outputs.length)
      return {
        ok: false as const,
        error_code: "empty_result",
        function: fn.signature,
        calldata: data,
      };
    const types = `(${fn.outputs.map((o) => o.type).join(",")})`;
    const dec = JSON.parse(w().evmAbiDecode(JSON.stringify({ input: raw, types }))) as {
      status?: string;
      args?: { type: string; value: unknown }[];
    };
    if (dec.status !== "ok" || !Array.isArray(dec.args))
      return {
        ok: false as const,
        error_code: "decode_failed",
        function: fn.signature,
        calldata: data,
        raw,
      };
    return {
      ok: true as const,
      chainId: info.chainId,
      address: info.address,
      function: fn.signature,
      calldata: data,
      raw,
      result: dec.args.map((a, k) => ({
        name: fn.outputs[k]?.name ?? `out${k}`,
        type: a.type,
        value: a.value,
      })),
    };
  }

  /** Build calldata for any function (read or write). Nothing is signed or sent. */
  async function encodeCall(i: Record<string, unknown>) {
    const info = await resolve(i);
    const fn = pickFn(info.functions, i.function ?? i.signature);
    const data = encode(fn, shapeArgs(fn, i.args));
    let value = "0";
    if (i.value !== undefined && i.value !== null && i.value !== "" && i.value !== "0") {
      if (!fn.payable) bad("value_on_non_payable");
      if (typeof i.value !== "string" || !/^\d{1,78}$/.test(i.value)) bad("bad_value");
      value = BigInt(i.value as string).toString();
    }
    const decoded = JSON.parse(
      w().evmAbiDecode(JSON.stringify({ input: data, abi: JSON.stringify(info.abi) })),
    ) as {
      status?: string;
      signature?: string;
      args?: unknown[];
    };
    if (decoded.status !== "ok" || decoded.signature !== fn.signature)
      bad("decode_check_failed", 500);
    return {
      ok: true as const,
      chainId: info.chainId,
      chain: info.chain,
      to: info.address,
      function: fn.signature,
      stateMutability: fn.stateMutability,
      value,
      data,
      decoded: { signature: decoded.signature, args: decoded.args },
      proxy: info.proxy,
      abiSource: info.abiSource,
      warnings: info.warnings,
      note: "Unsigned call data only. SwapChan never signs or sends; your own wallet does.",
    };
  }

  return { abiInfo, read, encodeCall };
}

const strip = (x: AbiInfo) => {
  const { abi: _abi, ...rest } = x;
  return rest;
};

export function contractRoutes(d: Deps, opts: { perMinute?: number } = {}) {
  const t = contractTool(d);
  const now = d.now ?? Date.now;
  const limit = opts.perMinute ?? RATE_PER_MIN;
  const windows = new Map<string, { start: number; count: number }>();
  const r = new Hono();
  r.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    const ts = now();
    const who = clientOf((n) => c.req.header(n), socketAddressOf(c.env));
    let win = windows.get(who);
    if (!win || ts - win.start >= 60_000) {
      win = { start: ts, count: 0 };
      windows.set(who, win);
      if (windows.size > 50_000) windows.clear();
    }
    win.count++;
    c.header("x-ratelimit-limit", String(limit));
    c.header("x-ratelimit-remaining", String(Math.max(0, limit - win.count)));
    if (win.count > limit) {
      c.header("retry-after", String(Math.ceil((win.start + 60_000 - ts) / 1000)));
      return c.json({ ok: false, error_code: "rate_limited", error: "rate_limited" }, 429);
    }
    await next();
  });
  const body = async (c: {
    req: { header: (n: string) => string | undefined; text: () => Promise<string> };
  }) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_BODY) bad("body_too_large", 413);
    const raw = await c.req.text().catch(() => "");
    if (raw.length > MAX_BODY) bad("body_too_large", 413);
    try {
      const j = JSON.parse(raw) as unknown;
      return j && typeof j === "object" && !Array.isArray(j)
        ? (j as Record<string, unknown>)
        : bad("bad_json");
    } catch (e) {
      if (e instanceof ContractError) throw e;
      return bad("bad_json");
    }
  };
  const run = async (
    c: { json: (v: unknown, s?: number) => Response },
    fn: () => Promise<unknown>,
  ) => {
    try {
      return c.json(await fn());
    } catch (e) {
      if (e instanceof ContractError)
        return c.json({ ok: false, error_code: e.code, error: e.code }, e.status as 400);
      return c.json({ ok: false, error_code: "internal_error", error: "internal_error" }, 500);
    }
  };
  r.get("/abi", (c) =>
    run(c, async () => ({
      ok: true,
      ...strip(
        await t.abiInfo({ chainId: c.req.query("chainId"), address: c.req.query("address") }),
      ),
    })),
  );
  r.post("/abi", (c) =>
    run(c, async () => ({
      ok: true,
      ...strip(await t.abiInfo((await body(c)) as Parameters<typeof t.abiInfo>[0])),
    })),
  );
  r.post("/read", (c) =>
    run(c, async () => {
      const out = await t.read(await body(c));
      return out;
    }),
  );
  r.post("/encode", (c) => run(c, async () => t.encodeCall(await body(c))));
  return r;
}
