import { usd } from "@/lib/intel";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const label = (k: string) =>
  k
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
const HIDE = new Set([
  "next",
  "swapUrl",
  "shortUrl",
  "display",
  "series",
  "history30d",
  "raw",
  "abi",
  "source",
]);

function fmt(k: string, v: unknown): React.ReactNode {
  if (v === null || v === undefined) return "–";
  if (typeof v === "number")
    return /usd/i.test(k) ? usd(v) : v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") {
    if (/^https:\/\/swapchan\.com\//.test(v))
      return (
        <a href={v} className="font-bold text-amber-300 underline">
          Swap →
        </a>
      );
    if (/^https?:\/\//.test(v))
      return (
        <a href={v} rel="nofollow noopener" target="_blank" className="text-fuchsia-300 underline">
          link
        </a>
      );
    return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  }
  if (Array.isArray(v))
    return v.every((x) => typeof x !== "object") ? v.join(", ") : `${v.length} items`;
  if (isObj(v))
    return Object.entries(v)
      .filter(([, x]) => typeof x !== "object")
      .slice(0, 4)
      .map(([a, b]) => `${label(a)}: ${String(b)}`)
      .join(" · ");
  return String(v);
}

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = [...new Set(rows.slice(0, 20).flatMap((r) => Object.keys(r)))]
    .filter((c) => !HIDE.has(c) || c === "swapUrl")
    .filter((c) =>
      rows.some((r) => r[c] !== undefined && (typeof r[c] !== "object" || r[c] === null)),
    )
    .slice(0, 8);
  return (
    <div className="overflow-x-auto rounded-xl border-2 border-violet-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-violet-900 text-violet-200">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-bold">
                {label(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows
            <tr key={i} className="border-t border-violet-800 odd:bg-violet-950/60">
              {cols.map((c) => (
                <td key={c} className="px-3 py-2 align-top break-words">
                  {fmt(c, r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Generic, readable render of any intel response: scalars as a fact grid, object arrays as tables. */
export function DataView({ data, depth = 0 }: { data: Record<string, unknown>; depth?: number }) {
  const entries = Object.entries(data).filter(([k]) => !HIDE.has(k));
  const scalars = entries.filter(([, v]) => !Array.isArray(v) && !isObj(v));
  const arrays = entries.filter(([, v]) => Array.isArray(v) && v.length && isObj(v[0])) as [
    string,
    Record<string, unknown>[],
  ][];
  const prims = entries.filter(([, v]) => Array.isArray(v) && v.length && !isObj(v[0]));
  const objs = entries.filter(([, v]) => isObj(v)) as [string, Record<string, unknown>][];
  return (
    <div className="flex flex-col gap-4">
      {scalars.length > 0 && (
        <dl className="grid gap-2 sm:grid-cols-2">
          {scalars.map(([k, v]) => (
            <div key={k} className="rounded-xl border-2 border-violet-700 bg-violet-950 px-3 py-2">
              <dt className="text-xs font-bold text-violet-300">{label(k)}</dt>
              <dd className="text-sm break-words">{fmt(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {objs.map(([k, v]) =>
        depth < 2 ? (
          <section key={k}>
            <h3 className="mb-2 font-black">{label(k)}</h3>
            <DataView data={v} depth={depth + 1} />
          </section>
        ) : null,
      )}
      {arrays.map(([k, v]) => (
        <section key={k}>
          <h3 className="mb-2 font-black">
            {label(k)} ({v.length})
          </h3>
          <Table rows={v} />
        </section>
      ))}
      {prims.map(([k, v]) => (
        <p key={k} className="text-xs text-violet-300">
          <b>{label(k)}:</b> {(v as unknown[]).join(" · ")}
        </p>
      ))}
    </div>
  );
}
