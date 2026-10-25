import { Hono } from "hono";
import { blocktools } from "./blocktools.js";

/**
 * Public developer & chain tools (swapchan.com/tools/<slug>, MCP address_tool / xpub_addresses / solana_address /
 * substrate_tool / chain_params): pure blocktools WASM calls on PUBLIC input only (addresses, xpubs, SS58, PDA
 * seeds, hashes, chain params). Nothing is fetched or stored.
 *
 * Safety rules (tested in devtools.test.ts):
 * - never log request bodies, inputs or outputs (this file has no console calls; errors return a code only);
 * - body capped at MAX_BODY bytes; per-client fixed-window rate limit;
 * - anything that looks like a secret (xprv/WIF/seed words/secret-named fields) is refused before any call;
 * - no raw signed-tx decode/verify here: that input never leaves the browser (waits for the web WASM build).
 */
export const MAX_BODY = 4096;
export const RATE_PER_MIN = 30;
const MAX_STR = 1024;

export class ToolError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const bad = (code: string): never => {
  throw new ToolError(code);
};

/** Extended private keys (any SLIP-132 prefix), WIF private keys, BIP39-like word lists, raw 32-byte keys by field name. */
const PRIV_EXT = /\b[xtyzuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{20,}/;
const WIF = /^(5[HJK][1-9A-HJ-NP-Za-km-z]{49}|[KLc9][1-9A-HJ-NP-Za-km-z]{50,51})$/;
const SEEDLIKE = /^\s*([a-z]{3,8}\s+){11,23}[a-z]{3,8}\s*$/;
const SECRET_KEY = /priv|secret|seed|mnemonic|wif|password|passphrase|keystore|xprv/i;

/** Throws secret_input_refused when any key or string value looks like private key material. */
export function refuseSecrets(v: unknown, depth = 0): void {
  if (depth > 4) bad("too_deep");
  if (typeof v === "string") {
    if (PRIV_EXT.test(v) || WIF.test(v.trim()) || SEEDLIKE.test(v)) bad("secret_input_refused");
    return;
  }
  if (Array.isArray(v)) return v.forEach((x) => refuseSecrets(x, depth + 1));
  if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      // "seeds" = public Solana PDA seed bytes, not a wallet seed
      if (k !== "seeds" && SECRET_KEY.test(k)) bad("secret_input_refused");
      refuseSecrets(x, depth + 1);
    }
}

type In = Record<string, unknown>;
const str = (i: In, k: string, re?: RegExp): string => {
  const v = i[k];
  if (typeof v !== "string" || !v.trim()) return bad(`missing_${k}`);
  const s = v.trim();
  if (s.length > MAX_STR) return bad(`too_long_${k}`);
  if (re && !re.test(s)) return bad(`bad_${k}`);
  return s;
};
const optStr = (i: In, k: string, re?: RegExp) =>
  i[k] === undefined || i[k] === "" ? undefined : str(i, k, re);
const int = (i: In, k: string, def: number, min: number, max: number): number => {
  const v = i[k] ?? def;
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return bad(`bad_${k}`);
  return n;
};
const CHAIN = /^[a-z0-9]{2,8}$/;
const HEX = /^(0x)?([0-9a-fA-F]{2})*$/;
const unhex = (s: string) => s.replace(/^0x/, "");
const json = (s: string) => JSON.parse(s) as unknown;

/** blocktools error text -> short machine code (never echoes the input). */
export const errCode = (e: unknown): string =>
  e instanceof ToolError
    ? e.code
    : (
        String((e as Error)?.message ?? e)
          .toLowerCase()
          .replace(/[^a-z0-9_:]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 48) || "invalid_input"
      ).replace(/^error_/, "");

export const XPUB_KINDS = ["p2pkh", "p2wpkh", "p2sh-p2wpkh", "p2tr"] as const;

/** Tool name -> pure function of public input. Names match the /tools/<slug> pages. */
export const DEV_TOOLS: Record<string, (i: In) => unknown> = {
  "detect-address": (i) => ({
    chains: json(w().detectAddress(str(i, "address"))),
  }),
  "validate-address": (i) => {
    const chain = str(i, "chain", CHAIN);
    try {
      return { chain, valid: true, kind: w().addressValidate(chain, str(i, "address")) };
    } catch (e) {
      return { chain, valid: false, reason: errCode(e) };
    }
  },
  "convert-address": (i) => {
    const address = str(i, "address");
    const to = str(i, "to", CHAIN);
    const from = optStr(i, "from", CHAIN);
    return {
      to,
      address: from ? w().convertAddressFrom(from, address, to) : w().convertAddress(address, to),
    };
  },
  cashaddr: (i) => {
    const op = str(i, "op", /^(to_legacy|to_cashaddr|decode)$/);
    const address = str(i, "address");
    if (op === "to_legacy") return { legacy: w().cashAddrToLegacy(address) };
    if (op === "decode") return json(w().cashAddrDecode(address));
    const prefix = optStr(i, "prefix", /^[a-z]{1,16}$/) ?? "bitcoincash";
    return { cashaddr: w().legacyToCashAddr(address, prefix) };
  },
  "address-script": (i) => {
    const op = str(i, "op", /^(to_script|from_script)$/);
    const chain = str(i, "chain", CHAIN);
    if (op === "from_script")
      return json(w().scriptToAddress(chain, unhex(str(i, "script", HEX)))) ?? { address: null };
    const address = str(i, "address");
    // known blocktools gaps (parity run 2026-10-25): Zcash and all-uppercase bech32 give wrong/no scripts
    if (chain === "zec") bad("unsupported_chain:zec");
    if (/^[A-Z]{2,4}1[A-Z0-9]{8,}$/.test(address)) bad("unsupported_uppercase_bech32");
    return { script: w().addressToScript(chain, address) };
  },
  "xpub-addresses": (i) => {
    const chain = str(i, "chain", CHAIN);
    const xpub = str(i, "xpub", /^[1-9A-HJ-NP-Za-km-z]{100,120}$/);
    const kind = optStr(i, "kind") ?? "p2pkh";
    if (!(XPUB_KINDS as readonly string[]).includes(kind)) bad("bad_kind");
    const branch = int(i, "branch", 0, 0, 1);
    const start = int(i, "start", 0, 0, 1_000_000);
    const count = int(i, "count", 10, 1, 20);
    const idx = Array.from({ length: count }, (_, n) => start + n);
    const out = json(
      w().addressesFromXpub(xpub, chain, [kind], Uint32Array.from([branch]), Uint32Array.from(idx)),
    ) as unknown[];
    if (!out.length) bad("kind_not_supported_for_chain");
    return { chain, kind, addresses: out };
  },
  ss58: (i) => {
    const op = str(i, "op", /^(decode|encode|convert)$/);
    if (op === "encode")
      return {
        address: w().ss58Encode(
          unhex(str(i, "account", /^(0x)?[0-9a-fA-F]{64}$/)),
          int(i, "prefix", 0, 0, 16383),
        ),
      };
    const d = json(w().ss58Decode(str(i, "address"))) as { prefix: number; account: string };
    if (op === "decode") return d;
    return { ...d, address: w().ss58Encode(d.account, int(i, "prefix", 0, 0, 16383)) };
  },
  "polkadot-storage-key": (i) => ({
    key: `0x${unhex(w().polkadotAccountStorageKey(str(i, "account")))}`,
  }),
  "decode-account-info": (i) =>
    json(w().decodeAccountInfo(unhex(str(i, "hex", /^(0x)?[0-9a-fA-F]{2,400}$/)))),
  "solana-pda": (i) => {
    const seeds = i.seeds;
    if (!Array.isArray(seeds) || seeds.length > 16) return bad("bad_seeds");
    const hex = seeds.map((s) => {
      if (typeof s !== "string" || !HEX.test(s) || unhex(s).length > 64) return bad("bad_seeds");
      return unhex(s);
    });
    return json(w().solFindProgramAddress(JSON.stringify(hex), str(i, "program")));
  },
  "solana-ata": (i) =>
    json(
      w().solAssociatedTokenAddress(
        str(i, "owner"),
        str(i, "mint"),
        optStr(i, "token_program") ?? "",
      ),
    ),
  "solana-on-curve": (i) => ({ onCurve: w().solIsOnCurve(str(i, "address")) }),
  "anchor-discriminator": (i) => ({
    discriminator: w().solAnchorDiscriminator(str(i, "name", /^[A-Za-z0-9_]{1,64}$/)),
  }),
  blake2b: (i) => ({
    hash: w().blake2b(
      unhex(str(i, "data", HEX)),
      int(i, "out_len", 32, 1, 64),
      typeof i.personal === "string" ? i.personal : "",
    ),
  }),
  twox128: (i) => ({ hash: w().twox128(str(i, "text")) }),
  base58: (i) => {
    const op = str(i, "op", /^(encode|decode)$/);
    return op === "encode"
      ? { base58: w().base58Encode(unhex(str(i, "data", HEX))) }
      : { hex: w().base58Decode(str(i, "data")) };
  },
  "chain-params": (i) => {
    const all = json(w().chainParams()) as { name: string }[];
    const chain = optStr(i, "chain", CHAIN);
    if (!chain) return { count: all.length, chains: all };
    const one = all.find((p) => p.name === chain);
    return one ?? bad("unknown_chain");
  },
};
const w = () => blocktools() ?? bad("blocktools_unavailable");

/** Run one tool. Returns a code on failure, never the input or a stack. */
export function runDevTool(
  fn: string,
  input: unknown,
): { ok: true; tool: string; result: unknown } | { ok: false; tool: string; error_code: string } {
  const tool = Object.hasOwn(DEV_TOOLS, fn) ? fn : "unknown";
  try {
    const run = DEV_TOOLS[tool] ?? bad("unknown_tool");
    if (!input || typeof input !== "object" || Array.isArray(input)) bad("bad_body");
    refuseSecrets(input);
    return { ok: true, tool, result: run(input as In) };
  } catch (e) {
    return { ok: false, tool, error_code: errCode(e) };
  }
}

/** Client key for the rate limit: the proxy-set client IP; never logged or stored beyond the 60s window. */
const clientOf = (h: (n: string) => string | undefined) =>
  h("cf-connecting-ip") ?? h("x-forwarded-for")?.split(",")[0]?.trim() ?? h("x-real-ip") ?? "local";

export function devToolRoutes(opts: { perMinute?: number; now?: () => number } = {}) {
  const limit = opts.perMinute ?? RATE_PER_MIN;
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  const r = new Hono();
  r.get("/", (c) => c.json({ tools: Object.keys(DEV_TOOLS), maxBody: MAX_BODY, perMinute: limit }));
  r.post("/:fn", async (c) => {
    c.header("cache-control", "no-store");
    const t = now();
    const who = clientOf((n) => c.req.header(n));
    let win = windows.get(who);
    if (!win || t - win.start >= 60_000) {
      win = { start: t, count: 0 };
      windows.set(who, win);
      if (windows.size > 50_000) windows.clear();
    }
    win.count++;
    c.header("x-ratelimit-limit", String(limit));
    c.header("x-ratelimit-remaining", String(Math.max(0, limit - win.count)));
    if (win.count > limit) {
      c.header("retry-after", String(Math.ceil((win.start + 60_000 - t) / 1000)));
      return c.json({ ok: false, error_code: "rate_limited" }, 429);
    }
    const fn = c.req.param("fn");
    if (Number(c.req.header("content-length") ?? 0) > MAX_BODY)
      return c.json({ ok: false, tool: fn, error_code: "body_too_large" }, 413);
    const raw = await c.req.text().catch(() => "");
    if (raw.length > MAX_BODY)
      return c.json({ ok: false, tool: fn, error_code: "body_too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, tool: fn, error_code: "bad_json" }, 400);
    }
    const out = runDevTool(fn, body);
    return c.json(out, out.ok ? 200 : out.error_code === "unknown_tool" ? 404 : 400);
  });
  return r;
}
