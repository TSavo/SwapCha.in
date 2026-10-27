"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { PoweredBy } from "@/components/devtools/PoweredBy";
import { API_URL } from "@/lib/agents";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
type Param = { name: string; type: string; components?: Param[] };
type Fn = {
  name: string;
  signature: string;
  selector: string;
  stateMutability: string;
  kind: "read" | "write";
  payable: boolean;
  inputs: Param[];
  outputs: Param[];
};
type Info = {
  chainId: number;
  chain: string;
  address: string;
  isContract: boolean;
  proxy: { kind: string; implementation: string } | null;
  abiSource: string | null;
  verifiedName: string | null;
  warnings: string[];
  functions: Fn[];
};
type Out = { name: string; type: string; value: unknown };
type Encoded = {
  chainId: number;
  chain: string;
  to: string;
  function: string;
  value: string;
  data: string;
  decoded: { signature?: string; args?: unknown[] };
  warnings: string[];
};

const CHAINS: [number, string][] = [
  [1, "Ethereum"],
  [8453, "Base"],
  [42161, "Arbitrum"],
  [10, "Optimism"],
  [137, "Polygon"],
  [56, "BNB Chain"],
  [43114, "Avalanche"],
  [59144, "Linea"],
  [534352, "Scroll"],
];
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const input =
  "w-full rounded-lg border border-violet-400 bg-violet-950/60 px-2 py-1 font-mono text-sm text-violet-50";
const btn =
  "rounded-lg bg-amber-400 px-3 py-1 text-sm font-bold text-violet-950 hover:bg-amber-300 disabled:opacity-50";

/** Text box value -> JSON argument: arrays/tuples as JSON, everything else as the typed string. */
export function toArg(type: string, raw: string): unknown {
  const t = raw.trim();
  if (type.endsWith("]") || type.startsWith("tuple") || type.startsWith("(")) return JSON.parse(t);
  if (type === "bool") return t === "true" || t === "1";
  return t;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_URL}/contract-tool/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as T & { ok?: boolean; error_code?: string; error?: string };
  if (!r.ok) throw new Error(String(j.error ?? j.error_code ?? r.status));
  return j;
}

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function FnCard(p: { fn: Fn; info: Info; abi?: string }) {
  const { fn, info } = p;
  const { address: me, connector } = useAccount();
  const [vals, setVals] = useState<string[]>(() => fn.inputs.map(() => ""));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [out, setOut] = useState<Out[]>();
  const [enc, setEnc] = useState<Encoded>();
  const [hash, setHash] = useState<string>();
  const body = () => ({
    chainId: info.chainId,
    address: info.address,
    function: fn.signature,
    args: fn.inputs.map((i, k) => toArg(i.type, vals[k] ?? "")),
    ...(p.abi ? { abi: p.abi } : {}),
  });
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await f();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const query = () =>
    run(async () => {
      setOut(undefined);
      const r = await post<{ ok: boolean; error_code?: string; result?: Out[] }>("read", body());
      if (!r.ok) throw new Error(`read failed: ${r.error_code}`);
      setOut(r.result);
    });
  const build = () =>
    run(async () => {
      setEnc(undefined);
      setHash(undefined);
      setEnc(await post<Encoded>("encode", { ...body(), ...(value ? { value } : {}) }));
    });
  const send = () =>
    run(async () => {
      if (!enc || !me || !connector) return;
      // Local check: the wallet gets exactly what is shown here.
      if (enc.to.toLowerCase() !== info.address.toLowerCase() || enc.chainId !== info.chainId)
        throw new Error("built call does not match this contract and chain");
      if (!enc.data.toLowerCase().startsWith(fn.selector.toLowerCase()))
        throw new Error("call data does not start with this function's selector");
      if (!fn.payable && enc.value !== "0") throw new Error("value on a non-payable function");
      const prov = (await connector.getProvider()) as Eip1193;
      await prov.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${enc.chainId.toString(16)}` }],
      });
      const tx = {
        from: me,
        to: enc.to,
        data: enc.data,
        value: `0x${BigInt(enc.value).toString(16)}`,
      };
      setHash(String(await prov.request({ method: "eth_sendTransaction", params: [tx] })));
    });
  return (
    <details className="rounded-xl border border-violet-500 bg-violet-900/40 p-3">
      <summary className="cursor-pointer font-mono text-sm font-bold">
        {fn.signature}
        {fn.payable ? " payable" : ""}
      </summary>
      <div className="mt-2 space-y-2">
        {fn.inputs.map((i, k) => (
          <label key={`${fn.signature}-${k}`} className="block text-xs text-violet-200">
            {i.name} ({i.type})
            <input
              className={input}
              value={vals[k]}
              placeholder={
                i.type.endsWith("]") || i.type.startsWith("tuple") ? "JSON, e.g. [1,2]" : i.type
              }
              onChange={(e) => setVals((v) => v.map((x, j) => (j === k ? e.target.value : x)))}
            />
          </label>
        ))}
        {fn.kind === "write" && fn.payable && (
          <label className="block text-xs text-violet-200">
            Value to send (wei, from your wallet)
            <input
              className={input}
              value={value}
              placeholder="0"
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        {fn.kind === "read" ? (
          <button type="button" className={btn} disabled={busy} onClick={query}>
            Query
          </button>
        ) : (
          <button type="button" className={btn} disabled={busy} onClick={build}>
            Build call
          </button>
        )}
        {err && <p className="text-sm font-bold text-rose-300">{err}</p>}
        {out && (
          <ul className="font-mono text-xs text-violet-100">
            {out.map((o, k) => (
              <li key={`${o.name}-${k}`} className="break-all">
                {o.name} ({o.type}): {show(o.value)}
              </li>
            ))}
          </ul>
        )}
        {enc && (
          <div className="space-y-1 rounded-lg border border-violet-400 p-2 text-xs">
            <p>
              To <span className="font-mono">{enc.to}</span> on {enc.chain} ({enc.chainId})
            </p>
            <p>Value: {enc.value} wei</p>
            <p className="font-mono">{enc.decoded.signature}</p>
            <ul className="font-mono">
              {(enc.decoded.args ?? []).map((a, k) => (
                <li key={`d-${k}`} className="break-all">
                  {show(a)}
                </li>
              ))}
            </ul>
            <p className="break-all font-mono text-violet-300">data: {enc.data}</p>
            {fn.payable && enc.value !== "0" && (
              <p className="font-bold text-amber-200">
                This sends {enc.value} wei of the chain&apos;s native coin to the contract.
              </p>
            )}
            {me ? (
              <button type="button" className={btn} disabled={busy} onClick={send}>
                Send with my wallet
              </button>
            ) : (
              <ConnectButton />
            )}
            {hash && <p className="break-all font-mono">Sent by your wallet: {hash}</p>}
          </div>
        )}
      </div>
    </details>
  );
}

export function ContractTool() {
  const [chainId, setChainId] = useState(1);
  const [address, setAddress] = useState("");
  const [abi, setAbi] = useState("");
  const [tab, setTab] = useState<"read" | "write">("read");
  const [info, setInfo] = useState<Info>();
  const [usedAbi, setUsedAbi] = useState<string>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setErr(undefined);
    setInfo(undefined);
    try {
      const a = abi.trim() || undefined;
      setInfo(
        await post<Info>("abi", { chainId, address: address.trim(), ...(a ? { abi: a } : {}) }),
      );
      setUsedAbi(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const fns = info?.functions.filter((f) => f.kind === tab) ?? [];
  return (
    <section className="space-y-4 text-violet-100">
      <div className="grid gap-2 md:grid-cols-[10rem_1fr]">
        <select
          className={input}
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
        >
          {CHAINS.map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <input
          className={input}
          value={address}
          placeholder="Contract address 0x…"
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-violet-200">
          Paste an ABI (optional)
        </summary>
        <textarea
          className={`${input} h-28`}
          value={abi}
          placeholder='[{"type":"function","name":"name",...}]'
          onChange={(e) => setAbi(e.target.value)}
        />
      </details>
      <button
        type="button"
        className={btn}
        disabled={busy || !ADDR.test(address.trim())}
        onClick={load}
      >
        Load contract
      </button>
      {err && <p className="text-sm font-bold text-rose-300">{err}</p>}
      {info && (
        <>
          <p className="text-sm">
            {info.verifiedName ?? "Contract"} on {info.chain}. ABI: {info.abiSource ?? "none"}
            {info.proxy ? ` (EIP-1967 proxy, implementation ${info.proxy.implementation})` : ""}
          </p>
          {info.warnings.map((w) => (
            <p
              key={w}
              className="rounded-xl border border-amber-400 bg-amber-400/10 p-2 text-sm font-bold text-amber-200"
            >
              {w}
            </p>
          ))}
          <div className="flex gap-2">
            {(["read", "write"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`rounded-lg px-3 py-1 text-sm font-bold ${tab === t ? "bg-violet-400 text-violet-950" : "border border-violet-400"}`}
                onClick={() => setTab(t)}
              >
                {t === "read" ? "Read Contract" : "Write Contract"}
              </button>
            ))}
          </div>
          {tab === "write" && (
            <p className="text-xs text-violet-200">
              Write calls are built here and signed and sent only by your own wallet. Check the
              target, chain, value and decoded call before you confirm in your wallet.
            </p>
          )}
          {fns.length === 0 && <p className="text-sm">No {tab} functions in this ABI.</p>}
          <div className="space-y-2">
            {fns.map((f) => (
              <FnCard key={`${f.signature}-${info.address}`} fn={f} info={info} abi={usedAbi} />
            ))}
          </div>
        </>
      )}
      <p className="text-xs text-violet-300">
        <PoweredBy />
      </p>
    </section>
  );
}
