/** The find_money freshness line: "As of 14:05 (cached)" / "As of 14:05 (fresh), block 23,456,789". */
export type Freshness = {
  asOf?: string;
  block?: number | null;
  cached?: boolean;
  freshRefused?: string;
  retryAfterSeconds?: number;
};

export function asOfLine(r: Freshness, timeZone?: string): string | null {
  if (!r.asOf) return null;
  const d = new Date(r.asOf);
  if (Number.isNaN(d.getTime())) return null;
  const hhmm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  let s = `As of ${hhmm} (${r.cached ? "cached" : "fresh"})`;
  if (typeof r.block === "number") s += `, Ethereum block ${r.block.toLocaleString("en-US")}`;
  if (r.freshRefused) s += `. Refresh is rate-limited, try again in ${r.retryAfterSeconds ?? 20}s`;
  return s;
}
