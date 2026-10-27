import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTASection } from "@/components/AgentCTASection";
import { SwapTabs } from "@/components/SwapTabs";
import { displayAddress } from "@/lib/address";
import { CHAIN_NAME } from "@/lib/intel";

export const metadata: Metadata = {
  title: "Batch swap: step through your swaps | SwapChan",
  description: "A prefilled list of swaps. Sign them one by one at the best price.",
  robots: { index: false, follow: true },
};
type Props = { searchParams: Promise<{ items?: string; ref?: string; step?: string }> };
type Row = [number, string, number, string, string];

function decode(s: string | undefined): Row[] {
  if (!s) return [];
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;
    return Array.isArray(v)
      ? (v.filter((r) => Array.isArray(r) && r.length >= 4).slice(0, 20) as Row[])
      : [];
  } catch {
    return [];
  }
}
/** Token addresses in full (EIP-55 for EVM), never shortened. */
const short = displayAddress;

export default async function Batch({ searchParams }: Props) {
  const sp = await searchParams;
  const rows = decode(sp.items);
  const step = Math.min(Math.max(Number(sp.step) || 0, 0), Math.max(rows.length - 1, 0));
  const cur = rows[step];
  const href = (i: number) => {
    const q = new URLSearchParams({
      items: sp.items ?? "",
      step: String(i),
      ...(sp.ref ? { ref: sp.ref } : {}),
    });
    return `/batch?${q}`;
  };
  if (!cur)
    return (
      <p className="rounded-2xl border-2 border-violet-600 bg-violet-950 p-4">
        This batch link is empty or broken.{" "}
        <Link href="/" className="font-bold text-amber-300 underline">
          Start a swap
        </Link>
      </p>
    );
  return (
    <div className="w-full">
      <h1 className="text-2xl font-black">
        Batch swap: step {step + 1} of {rows.length}
      </h1>
      <p className="mb-4 text-sm text-violet-200">
        Sign each swap, then move to the next. Each one is quoted live at the best price.
      </p>
      <div className="flex w-full flex-col gap-6 lg:flex-row-reverse lg:items-start">
        <div className="w-full shrink-0 lg:w-[26rem]">
          <SwapTabs
            key={step}
            initial={{
              fromChain: cur[0],
              fromToken: cur[1],
              toChain: cur[2],
              toToken: cur[3],
              amount: cur[4] ?? "",
            }}
          />
        </div>
        <ol className="flex flex-1 flex-col gap-2">
          {rows.map((r, i) => (
            <li key={`${r[0]}-${r[1]}-${i}`}>
              <Link
                href={href(i)}
                className={`flex items-center justify-between rounded-xl border-2 px-3 py-2 text-sm break-all ${i === step ? "border-amber-300 bg-violet-900" : "border-violet-700 bg-violet-950 hover:border-amber-300"}`}
              >
                <span>
                  <b>#{i + 1}</b> {r[4] || ""} {short(r[1])} on {CHAIN_NAME[r[0]] ?? r[0]} →{" "}
                  {short(r[3])}
                  {r[2] !== r[0] ? ` on ${CHAIN_NAME[r[2]] ?? r[2]}` : ""}
                </span>
                <span className="font-bold text-amber-300">{i === step ? "Now" : "Go"}</span>
              </Link>
            </li>
          ))}
          {step + 1 < rows.length && (
            <Link
              href={href(step + 1)}
              className="mt-2 rounded-xl border-2 border-violet-950 bg-amber-400 px-5 py-3 text-center font-black text-violet-950 hover:bg-amber-300"
            >
              Next swap →
            </Link>
          )}
        </ol>
      </div>
      <AgentCTASection />
    </div>
  );
}
