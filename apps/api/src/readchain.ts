/**
 * read_chain: generic, strictly read-only chain state for every SwapChan chain.
 * EVM (JSON-RPC allowlist of read methods only, any historical blockTag), Solana (account/program/token reads),
 * Tron (TronGrid constant calls + account resources), Bitcoin (mempool.space UTXOs/address/tx).
 * There is no code path here that can send, sign or broadcast anything.
 */
import { BITCOIN, SOLANA, TRON } from "@swapchan/shared";
import {
  type Abi,
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  erc20Abi,
  formatUnits,
  type Hex,
  isAddress,
  parseAbi,
  parseAbiItem,
} from "viem";
import { encodeFunctionData } from "./blocktools.js";
import {
  BadRequest,
  chainName,
  chainOf,
  EVM_IDS,
  EXPLORER,
  evmClient,
  json,
  solRpc,
} from "./onchain.js";

type F = typeof fetch;
export const READ_OPS = [
  "balance",
  "token_balance",
  "call",
  "storage",
  "code",
  "logs",
  "block",
  "tx",
  "receipt",
  "nonce",
  "contract",
  "sol_account",
  "sol_program_accounts",
  "sol_token_accounts",
  "sol_signatures",
  "tron_account",
  "tron_resources",
  "tron_call",
  "btc_utxos",
  "btc_address",
  "btc_tx",
] as const;
export type ReadOp = (typeof READ_OPS)[number];
export interface ReadChainReq {
  chainId: string | number;
  op: ReadOp;
  address?: string;
  token?: string;
  owner?: string;
  function?: string;
  abi?: unknown;
  args?: unknown[];
  slot?: string;
  event?: string;
  topics?: (string | null)[];
  fromBlock?: string | number;
  toBlock?: string | number;
  blockTag?: string | number;
  hash?: string;
  block?: string | number;
  filters?: unknown[];
  encoding?: string;
  limit?: number;
}
/** The only JSON-RPC methods read_chain will ever send. No eth_sendRawTransaction, no eth_sign*. */
export const EVM_READ_METHODS = new Set([
  "eth_getBalance",
  "eth_call",
  "eth_getStorageAt",
  "eth_getCode",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_blockNumber",
]);

const big = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v, big));
const hexQ = (v: string | number | bigint) => `0x${BigInt(v).toString(16)}`;
function tag(v: string | number | undefined): string {
  if (v === undefined || v === "" || v === "latest") return "latest";
  if (typeof v === "string" && ["earliest", "pending", "safe", "finalized"].includes(v)) return v;
  if (typeof v === "string" && /^0x[0-9a-f]+$/i.test(v)) return v.length === 66 ? v : hexQ(v);
  if (/^\d+$/.test(String(v))) return hexQ(String(v));
  throw new BadRequest(`bad blockTag ${v}`);
}
function needAddr(a: string | undefined, what = "address"): Hex {
  if (!a || !isAddress(a)) throw new BadRequest(`${what} must be an EVM 0x address`);
  return a as Hex;
}
function abiOf(r: ReadChainReq): Abi {
  if (Array.isArray(r.abi)) return r.abi as Abi;
  if (typeof r.abi === "string") return parseAbi([r.abi]) as Abi;
  if (r.function) {
    const sig = r.function.startsWith("function ") ? r.function : `function ${r.function}`;
    return parseAbi([
      sig.includes(" view") || sig.includes(" returns") ? sig : `${sig} view`,
    ]) as Abi;
  }
  throw new BadRequest(
    'call needs function (e.g. "balanceOf(address) view returns (uint256)") or abi',
  );
}

async function evm(env: NodeJS.ProcessEnv, chainId: number, r: ReadChainReq) {
  const c = evmClient(chainId, env);
  const rpc = async (method: string, params: unknown[]) => {
    if (!EVM_READ_METHODS.has(method)) throw new BadRequest(`${method} is not a read method`);
    return (c.request as (a: { method: string; params: unknown[] }) => Promise<unknown>)({
      method,
      params,
    });
  };
  const bt = tag(r.blockTag);
  switch (r.op) {
    case "balance": {
      const wei = BigInt((await rpc("eth_getBalance", [needAddr(r.address), bt])) as string);
      return { wei: wei.toString(), formatted: formatUnits(wei, 18) };
    }
    case "nonce":
      return {
        nonce: Number(
          BigInt((await rpc("eth_getTransactionCount", [needAddr(r.address), bt])) as string),
        ),
      };
    case "token_balance": {
      const token = needAddr(r.token, "token");
      const owner = needAddr(r.owner ?? r.address, "owner");
      const call = (data: Hex) => rpc("eth_call", [{ to: token, data }, bt]) as Promise<Hex>;
      const [raw, dec, sym] = await Promise.all([
        call(encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] })),
        call(encodeFunctionData({ abi: erc20Abi, functionName: "decimals" })).catch(() => null),
        call(encodeFunctionData({ abi: erc20Abi, functionName: "symbol" })).catch(() => null),
      ]);
      const bal = decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: raw });
      const decimals = dec
        ? Number(decodeFunctionResult({ abi: erc20Abi, functionName: "decimals", data: dec }))
        : 18;
      let symbol: string | null = null;
      try {
        symbol = sym
          ? String(decodeFunctionResult({ abi: erc20Abi, functionName: "symbol", data: sym }))
          : null;
      } catch {}
      return {
        token,
        owner,
        raw: bal.toString(),
        decimals,
        symbol,
        formatted: formatUnits(bal, decimals),
      };
    }
    case "call": {
      const to = needAddr(r.address);
      const abi = abiOf(r);
      const fn = (abi.find((x) => x.type === "function") as { name: string } | undefined)?.name;
      if (!fn) throw new BadRequest("abi has no function");
      const data = encodeFunctionData({ abi, functionName: fn, args: (r.args ?? []) as never });
      const raw = (await rpc("eth_call", [
        { to, data, ...(r.owner ? { from: r.owner } : {}) },
        bt,
      ])) as Hex;
      let decoded: unknown = null;
      try {
        decoded = decodeFunctionResult({ abi, functionName: fn, data: raw });
      } catch (e) {
        decoded = { error: (e as Error).message.slice(0, 160) };
      }
      return { to, function: fn, calldata: data, raw, decoded: plain(decoded) };
    }
    case "storage": {
      if (r.slot === undefined) throw new BadRequest("slot is required");
      const slot = /^0x/i.test(r.slot) ? r.slot : hexQ(r.slot);
      const v = (await rpc("eth_getStorageAt", [needAddr(r.address), slot, bt])) as Hex;
      const tail = `0x${v.slice(-40)}`;
      return {
        slot,
        value: v,
        asUint: BigInt(v).toString(),
        asAddress: isAddress(tail) ? tail : null,
      };
    }
    case "code": {
      const code = (await rpc("eth_getCode", [needAddr(r.address), bt])) as Hex;
      return {
        isContract: code !== "0x",
        bytes: (code.length - 2) / 2,
        code: code.length > 20_002 ? `${code.slice(0, 20_002)}…` : code,
      };
    }
    case "logs": {
      const head = BigInt((await rpc("eth_blockNumber", [])) as string);
      const to = r.toBlock === undefined || r.toBlock === "latest" ? head : BigInt(r.toBlock);
      const from = r.fromBlock === undefined ? to - 2000n : BigInt(r.fromBlock);
      if (from < 0n || to < from) throw new BadRequest("bad block range");
      if (to - from > 50_000n)
        throw new BadRequest("block range max 50000 per call; page through it");
      let topics = r.topics;
      let ev: ReturnType<typeof parseAbiItem> | null = null;
      if (r.event) {
        ev = parseAbiItem(r.event.startsWith("event ") ? r.event : `event ${r.event}`);
        const t0 = encodeEventTopics({ abi: [ev] as Abi })[0];
        topics = [(t0 as string | undefined) ?? null, ...(r.topics ?? []).slice(1)];
      }
      const logs = (await rpc("eth_getLogs", [
        {
          ...(r.address ? { address: needAddr(r.address) } : {}),
          fromBlock: hexQ(from),
          toBlock: hexQ(to),
          ...(topics ? { topics } : {}),
        },
      ])) as {
        topics: Hex[];
        data: Hex;
        blockNumber: Hex;
        transactionHash: Hex;
        address: Hex;
        logIndex: Hex;
      }[];
      const lim = Math.min(r.limit ?? 200, 1000);
      return {
        fromBlock: from.toString(),
        toBlock: to.toString(),
        count: logs.length,
        truncated: logs.length > lim,
        logs: logs.slice(-lim).map((l) => {
          let decoded: unknown;
          if (ev) {
            try {
              decoded = plain(
                decodeEventLog({
                  abi: [ev] as Abi,
                  data: l.data,
                  topics: l.topics as [Hex, ...Hex[]],
                }).args,
              );
            } catch {}
          }
          return {
            address: l.address,
            block: Number(BigInt(l.blockNumber)),
            tx: l.transactionHash,
            logIndex: Number(BigInt(l.logIndex)),
            topics: l.topics,
            data: l.data,
            ...(decoded ? { decoded } : {}),
          };
        }),
      };
    }
    case "block": {
      const b = r.block ?? r.blockTag;
      const isHash = typeof b === "string" && /^0x[0-9a-f]{64}$/i.test(b);
      return (
        (await rpc(isHash ? "eth_getBlockByHash" : "eth_getBlockByNumber", [
          isHash ? b : tag(b),
          false,
        ])) ?? { found: false }
      );
    }
    case "tx":
    case "receipt": {
      if (!r.hash || !/^0x[0-9a-f]{64}$/i.test(r.hash))
        throw new BadRequest("hash (0x + 64 hex) is required");
      return (
        (await rpc(r.op === "tx" ? "eth_getTransactionByHash" : "eth_getTransactionReceipt", [
          r.hash,
        ])) ?? { found: false }
      );
    }
    default:
      throw new BadRequest(`op ${r.op} is not valid on EVM chains`);
  }
}

async function sol(f: F, env: NodeJS.ProcessEnv, r: ReadChainReq) {
  const enc = r.encoding === "base64" ? "base64" : "jsonParsed";
  const need = () => {
    if (!r.address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.address))
      throw new BadRequest("address must be a base58 Solana address");
    return r.address;
  };
  switch (r.op) {
    case "balance": {
      const v = await solRpc<{ value: number }>(f, env, "getBalance", [need()]);
      return { lamports: v.value, sol: v.value / 1e9 };
    }
    case "sol_account":
      return solRpc(f, env, "getAccountInfo", [need(), { encoding: enc }]);
    case "sol_program_accounts": {
      const res = await solRpc<unknown[]>(f, env, "getProgramAccounts", [
        need(),
        {
          encoding: enc,
          ...(r.filters ? { filters: r.filters } : {}),
          ...(r.encoding === "base64" ? { dataSlice: { offset: 0, length: 0 } } : {}),
        },
      ]);
      const lim = Math.min(r.limit ?? 100, 1000);
      return { count: res.length, truncated: res.length > lim, accounts: res.slice(0, lim) };
    }
    case "token_balance":
    case "sol_token_accounts": {
      const owner = r.owner ?? need();
      const progs = [
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ];
      const out = await Promise.all(
        progs.map((p) =>
          solRpc<{ value: unknown[] }>(f, env, "getTokenAccountsByOwner", [
            owner,
            r.token ? { mint: r.token } : { programId: p },
            { encoding: "jsonParsed" },
          ]).catch(() => ({ value: [] })),
        ),
      );
      const accounts = (r.token ? [out[0]] : out).flatMap((o) => o?.value ?? []);
      return { owner, count: accounts.length, accounts };
    }
    case "sol_signatures":
      return solRpc(f, env, "getSignaturesForAddress", [
        need(),
        { limit: Math.min(r.limit ?? 50, 1000) },
      ]);
    case "tx":
      if (!r.hash) throw new BadRequest("hash (signature) is required");
      return solRpc(f, env, "getTransaction", [
        r.hash,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);
    default:
      throw new BadRequest(`op ${r.op} is not valid on Solana`);
  }
}

async function tron(f: F, env: NodeJS.ProcessEnv, r: ReadChainReq) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = env.TRONGRID_API_KEY;
  const post = <T>(p: string, body: unknown) =>
    json<T>(f, `https://api.trongrid.io/wallet/${p}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const need = () => {
    if (!r.address || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(r.address))
      throw new BadRequest("address must be a Tron T… address");
    return r.address;
  };
  switch (r.op) {
    case "balance":
    case "tron_account":
      return post("getaccount", { address: need(), visible: true });
    case "tron_resources":
      return post("getaccountresource", { address: need(), visible: true });
    case "token_balance":
    case "tron_call": {
      const fn =
        r.op === "token_balance"
          ? "balanceOf(address)"
          : r.function?.replace(/^function /, "").replace(/\s.*$/, "");
      if (!fn) throw new BadRequest('tron_call needs function, e.g. "balanceOf(address)"');
      const contract = r.op === "token_balance" ? r.token : need();
      if (!contract) throw new BadRequest("token is required");
      return post("triggerconstantcontract", {
        owner_address: r.owner ?? r.address ?? "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
        contract_address: contract,
        function_selector: fn,
        parameter:
          typeof r.args?.[0] === "string" && /^[0-9a-f]*$/i.test(r.args[0] as string)
            ? r.args[0]
            : "",
        visible: true,
      });
    }
    case "tx":
      return post("gettransactioninfobyid", { value: String(r.hash ?? "").replace(/^0x/, "") });
    default:
      throw new BadRequest(`op ${r.op} is not valid on Tron`);
  }
}

async function btc(f: F, r: ReadChainReq) {
  const base = "https://mempool.space/api";
  switch (r.op) {
    case "btc_utxos":
    case "balance":
    case "btc_address": {
      if (!r.address || !/^(bc1|[13])[0-9A-Za-z]{20,90}$/.test(r.address))
        throw new BadRequest("address must be a Bitcoin address");
      if (r.op === "btc_utxos") {
        const u = await json<{ value: number }[]>(f, `${base}/address/${r.address}/utxo`);
        return {
          count: u.length,
          totalSats: u.reduce((s, x) => s + x.value, 0),
          utxos: u.slice(0, Math.min(r.limit ?? 500, 2000)),
        };
      }
      const a = await json<{
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
        mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
      }>(f, `${base}/address/${r.address}`);
      const sats = a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum;
      return { ...a, confirmedSats: sats, btc: sats / 1e8 };
    }
    case "btc_tx":
    case "tx":
      if (!r.hash || !/^[0-9a-f]{64}$/i.test(r.hash))
        throw new BadRequest("hash (64 hex txid) is required");
      return json(f, `${base}/tx/${r.hash}`);
    default:
      throw new BadRequest(`op ${r.op} is not valid on Bitcoin`);
  }
}

export async function readChain(
  f: F,
  env: NodeJS.ProcessEnv,
  r: ReadChainReq,
  deps: { contract?: (chainId: number, address: string) => Promise<unknown> } = {},
) {
  if (!READ_OPS.includes(r.op)) throw new BadRequest(`op must be one of ${READ_OPS.join(", ")}`);
  const chainId = chainOf(r.chainId);
  let result: unknown;
  if (r.op === "contract") {
    if (!r.address || !deps.contract) throw new BadRequest("address is required");
    result = await deps.contract(chainId, r.address);
  } else if (EVM_IDS.includes(chainId)) result = await evm(env, chainId, r);
  else if (chainId === SOLANA) result = await sol(f, env, r);
  else if (chainId === TRON) result = await tron(f, env, r);
  else if (chainId === BITCOIN) result = await btc(f, r);
  else throw new BadRequest(`unsupported chain ${chainId}`);
  return {
    chainId,
    chain: chainName(chainId),
    op: r.op,
    ...(r.blockTag !== undefined && EVM_IDS.includes(chainId) ? { blockTag: tag(r.blockTag) } : {}),
    readOnly: true,
    explorer: EXPLORER[chainId],
    result: plain(result),
    trust: "Strictly read-only: read_chain cannot sign, send or broadcast anything.",
    next: "Use read_chain to confirm find_money evidence yourself, then verify_tx before any signature. See swapchan_playbook.",
  };
}
