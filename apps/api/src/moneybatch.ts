/**
 * find_money for many wallets at once: paste a list of public addresses (any chains, ENS/.sol/Basenames,
 * mixed), get a job id, poll progress, and finish with an aggregated total, a ranked list across all
 * wallets, a summary the agent can relay verbatim and one "recover and swap all" plan.
 * Read-only: it only calls findMoney per address. Never accepts or stores secrets.
 */
import { randomUUID } from "node:crypto";
import { BadRequest } from "./onchain.js";

type Money = Record<string, unknown> & {
  address?: string;
  name?: string;
  totalEstUsd?: number;
  atRiskUsd?: number;
  portfolioUsd?: number | null;
  items?: Item[];
  swapAll?: { url?: string; shortUrl?: string };
  errors?: string[];
};
type Item = Record<string, unknown> & {
  title: string;
  estUsd: number | null;
  estimateKind: string;
  category: string;
  action?: string;
  swapUrl?: string;
  shortUrl?: string;
  steps?: { label?: string; url?: string; shortUrl?: string; kind?: string }[];
};
export type FindOne = (input: string) => Promise<Money>;
type Status = "queued" | "running" | "done";
interface Job {
  id: string;
  createdAt: number;
  status: Status;
  inputs: { input: string; kind: string }[];
  results: Record<
    string,
    { status: "pending" | "running" | "done" | "error"; result?: Money; error?: string }
  >;
}
const JOBS = new Map<string, Job>();
const TTL = 6 * 3600_000;
const MAX = 50;

const SECRET_HINT =
  /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b|^(?:0x)?[0-9a-f]{64}$|^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$|^xprv/i;

/** Classify one token. Returns null for junk. EVM addresses are scanned on every EVM chain by find_money. */
export function classify(s: string): string | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return "evm (all EVM chains)";
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return "tron";
  if (/^(bc1[0-9a-z]{25,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(s)) return "bitcoin";
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(eth|sol)$/i.test(s))
    return s.toLowerCase().endsWith(".sol") ? "sns (solana)" : "ens/basename (all EVM chains)";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return "solana";
  return null;
}

export function parseAddresses(input: string | string[]) {
  const raw = Array.isArray(input) ? input.join("\n") : input;
  if (SECRET_HINT.test(raw.trim()))
    throw new BadRequest(
      "That looks like a recovery phrase or private key. Never paste those anywhere: SwapChan only needs PUBLIC addresses. Derive addresses locally with recovery_guide.",
    );
  const seen = new Set<string>();
  const out: { input: string; kind: string }[] = [];
  const ignored: string[] = [];
  for (const t of raw
    .split(/[\s,;]+/)
    .map((x) => x.trim().replace(/^["'`(<]+|["'`)>.]+$/g, ""))
    .filter(Boolean)) {
    const k = classify(t);
    const key = k?.startsWith("evm") ? t.toLowerCase() : t;
    if (!k) ignored.push(t);
    else if (!seen.has(key)) {
      seen.add(key);
      out.push({ input: t, kind: k });
    }
  }
  if (!out.length)
    throw new BadRequest(
      "no public addresses found (EVM 0x…, ENS/.base.eth, .sol, Solana, Tron T…, Bitcoin)",
    );
  if (out.length > MAX) throw new BadRequest(`max ${MAX} addresses per batch`);
  return { addresses: out, ignored };
}

function gc() {
  const now = Date.now();
  for (const [k, j] of JOBS) if (now - j.createdAt > TTL) JOBS.delete(k);
}

export function startBatch(find: FindOne, input: string | string[], concurrency = 4) {
  gc();
  const { addresses, ignored } = parseAddresses(input);
  const job: Job = {
    id: randomUUID(),
    createdAt: Date.now(),
    status: "running",
    inputs: addresses,
    results: Object.fromEntries(addresses.map((a) => [a.input, { status: "pending" as const }])),
  };
  JOBS.set(job.id, job);
  const queue = [...addresses];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const slot = job.results[a.input]!;
      slot.status = "running";
      try {
        slot.result = await find(a.input);
        slot.status = "done";
      } catch (e) {
        slot.status = "error";
        slot.error = (e as Error).message.slice(0, 200);
      }
    }
  };
  void Promise.all(Array.from({ length: Math.min(concurrency, addresses.length) }, worker)).then(
    () => {
      job.status = "done";
    },
  );
  return { ignored, ...view(job) };
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function view(job: Job) {
  const entries = job.inputs.map((a) => ({ ...a, ...job.results[a.input]! }));
  const done = entries.filter((e) => e.status === "done" || e.status === "error").length;
  const progress = {
    done,
    total: entries.length,
    percent: Math.round((done / entries.length) * 100),
  };
  const wallets = entries.map((e) => ({
    input: e.input,
    kind: e.kind,
    status: e.status,
    ...(e.result
      ? {
          address: e.result.address,
          totalEstUsd: e.result.totalEstUsd ?? 0,
          atRiskUsd: e.result.atRiskUsd ?? 0,
          opportunities: e.result.items?.length ?? 0,
          ...(e.result.swapAll ? { swapAll: e.result.swapAll } : {}),
        }
      : {}),
    ...(e.error ? { error: e.error } : {}),
  }));
  const items = entries
    .flatMap((e) =>
      (e.result?.items ?? []).map((i) => ({
        wallet: e.result?.name ?? e.result?.address ?? e.input,
        ...i,
      })),
    )
    .sort((a, b) => (b.estUsd ?? 0) - (a.estUsd ?? 0))
    .map((i, n) => ({ ...i, rank: n + 1 }));
  const money = items.filter((i) => i.estimateKind !== "protected");
  const totalEstUsd = r2(money.reduce((s, i) => s + (i.estUsd ?? 0), 0));
  const atRiskUsd = r2(
    items.filter((i) => i.estimateKind === "protected").reduce((s, i) => s + (i.estUsd ?? 0), 0),
  );
  const exact = r2(
    money.filter((i) => i.estimateKind === "exact").reduce((s, i) => s + (i.estUsd ?? 0), 0),
  );
  const finished = job.status === "done";
  const link = (u?: string, s?: string) =>
    [s ? `short: ${s}` : null, u ? `full: ${u}` : null].filter(Boolean).join(" | ");
  const plan = {
    title: "Recover and swap all",
    rules:
      "Before EVERY signature: verify_tx on the exact unsigned tx, show the human the plain-English summary, get an explicit yes for THAT tx, sign in their own wallet, broadcast_tx, tx_status. Never batch approvals the human has not seen.",
    phase1_recover: money
      .filter((i) => i.steps?.[0]?.kind === "recover")
      .map((i) => ({ wallet: i.wallet, title: i.title, estUsd: i.estUsd, step: i.steps![0] })),
    phase2_protect: items
      .filter((i) => i.estimateKind === "protected")
      .map((i) => ({
        wallet: i.wallet,
        title: i.title,
        estUsd: i.estUsd,
        action: i.action,
        url: i.shortUrl ?? i.swapUrl,
      })),
    phase3_swap: wallets
      .filter((w) => w.swapAll)
      .map((w) => ({ wallet: w.address ?? w.input, ...w.swapAll })),
  };
  const lines = [
    finished
      ? `I scanned ${entries.length} wallet${entries.length > 1 ? "s" : ""} and found about ${usd(totalEstUsd)} for you${exact ? ` (${usd(exact)} of it exact, on-chain)` : ""}${atRiskUsd ? `, plus ${usd(atRiskUsd)} exposed to risky approvals/tokens to protect` : ""}.`
      : `Scanning ${progress.done}/${progress.total} wallets so far: about ${usd(totalEstUsd)} found.`,
    ...money
      .slice(0, 10)
      .map(
        (i) =>
          `${i.rank}. ${i.title} — ${i.estUsd == null ? "?" : usd(i.estUsd)} (${i.estimateKind}) on ${i.wallet}. ${link(i.steps?.[0]?.url ?? i.swapUrl, i.steps?.[0]?.shortUrl ?? i.shortUrl)}`,
      ),
    money.length > 10 ? `…and ${money.length - 10} more.` : "",
    plan.phase3_swap.length
      ? `Swap everything to USDC afterwards: ${plan.phase3_swap.map((s) => link(s.url, s.shortUrl)).join(" ; ")}`
      : "",
    "Nothing moves without you: I'll verify each transaction and show you exactly what it does before your own wallet signs it. SwapChan never holds keys.",
  ].filter(Boolean);
  return {
    jobId: job.id,
    status: job.status,
    progress,
    ...(finished ? {} : { pollAfterSeconds: 15, poll: "call find_money_status with jobId" }),
    totalEstUsd,
    exactUsd: exact,
    atRiskUsd,
    wallets,
    items,
    plan,
    summary: lines.join("\n"),
    summaryHint: "Relay `summary` to the user verbatim; it contains both short and full links.",
  };
}

export function batchStatus(id: string) {
  const j = JOBS.get(id);
  if (!j) throw new BadRequest("unknown or expired jobId (jobs live 6h)");
  return view(j);
}
