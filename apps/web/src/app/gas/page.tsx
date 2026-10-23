import type { Metadata } from "next";
import Link from "next/link";
import { DataView } from "@/components/tools/DataView";
import { ToolFrame } from "@/components/tools/ToolFrame";
import { CHAIN_NAME, intel } from "@/lib/intel";
import { tool } from "@/lib/toolList";

export const revalidate = 120;
const CHAINS = [1, 8453, 42161, 10, 137, 56];
type Props = { searchParams: Promise<{ chain?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const c = Number((await searchParams).chain) || 1;
  return {
    title: `${CHAIN_NAME[c] ?? "Ethereum"} gas tracker & best time to swap | SwapChan`,
    description: `Live ${CHAIN_NAME[c] ?? "Ethereum"} base fee, 1024-block percentiles, swap cost in USD and the cheapest hour of the day to swap. Free.`,
    alternates: { canonical: c === 1 ? "/gas" : `/gas?chain=${c}` },
  };
}

function Bars({ values, labels, title }: { values: number[]; labels?: string[]; title: string }) {
  if (!values.length) return null;
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  return (
    <figure>
      <figcaption className="mb-1 text-sm font-bold">{title}</figcaption>
      <div
        className="flex h-40 items-end gap-px rounded-xl border-2 border-violet-700 bg-violet-950 p-2"
        role="img"
        aria-label={title}
      >
        {values.map((v, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: chart bars
            key={i}
            title={`${labels?.[i] ?? ""} ${v} gwei`}
            className={`flex-1 rounded-t ${v === min ? "bg-emerald-400" : "bg-fuchsia-400"}`}
            style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
          />
        ))}
      </div>
      {labels && (
        <p className="mt-1 flex justify-between text-[10px] text-violet-400">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </p>
      )}
    </figure>
  );
}

export default async function GasPage({ searchParams }: Props) {
  const c = Number((await searchParams).chain) || 1;
  const d = await intel(`/onchain/gas/history?chain=${c}`, 120);
  const series = (d?.series as number[] | undefined) ?? [];
  const hours = ((d?.byHourUtc as { hourUtc: number; avgGwei: number }[] | undefined) ?? []).sort(
    (a, b) => a.hourUtc - b.hourUtc,
  );
  return (
    <ToolFrame
      info={tool("best_time_to_swap")}
      path="/gas"
      h1={`${CHAIN_NAME[c] ?? "Ethereum"} gas now & best time to swap`}
      intro={
        typeof d?.recommendation === "string"
          ? d.recommendation
          : "Live base fee and the cheapest hour to swap."
      }
      data={d}
      form={
        <div className="flex flex-wrap gap-2">
          {CHAINS.map((x) => (
            <Link
              key={x}
              href={x === 1 ? "/gas" : `/gas?chain=${x}`}
              className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold ${x === c ? "border-amber-300 bg-amber-400 text-violet-950" : "border-violet-600 bg-violet-950 hover:border-amber-300"}`}
            >
              {CHAIN_NAME[x]}
            </Link>
          ))}
        </div>
      }
    >
      {d && !d.error && (
        <>
          <Bars values={series} title="Base fee, last ~1024 blocks (gwei, green = cheapest)" />
          <Bars
            values={hours.map((h) => h.avgGwei)}
            labels={hours.map((h) => `${h.hourUtc}:00 UTC`)}
            title={`Average base fee by hour of day (UTC)${typeof d.historyDays === "number" && d.historyDays < 3 ? ": still collecting, chart fills in over the next days" : ""}`}
          />
          <DataView data={d} />
        </>
      )}
    </ToolFrame>
  );
}
