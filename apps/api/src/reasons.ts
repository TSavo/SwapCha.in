/**
 * User-visible reasons for sources that could not be checked.
 * Raw provider errors can carry RPC URLs (sometimes with API keys) and request bodies, so they never
 * reach a result: they collapse to a short, fixed reason. Timeouts say plainly that results may be incomplete.
 */
const URL_RE = /\b(?:https?|wss?):\/\/[^\s)"']*/gi;
const SECRETISH_RE = /\b(?:api[-_]?key|apikey|key|token|secret|auth)=[^\s&)"']+/gi;
const RAW_RE =
  /https?:\/\/|wss?:\/\/|URL:|Request body|Details:|Version: viem|HTTP request failed|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|status code|\bstatus \d{3}\b|\bRPC\b|JSON-RPC|Reques\b|api[-_]?key|token=/i;

export const INCOMPLETE = "results may be incomplete";

/** Map any thrown value to a short reason that is safe to show to a user. */
export function safeReason(e: unknown): string {
  const msg = String((e as Error)?.message ?? e ?? "");
  const t = /timed out after ([\d.]+)s/i.exec(msg);
  if (t) return `timed out after ${t[1]}s, ${INCOMPLETE}`;
  if (/timed? ?out|timeout/i.test(msg)) return `timed out, ${INCOMPLETE}`;
  if (/scan finished|request cancelled|aborted/i.test(msg)) return "scan finished";
  if (/\b429\b|rate.?limit|too many requests/i.test(msg)) return "rate limited by the data source";
  if (RAW_RE.test(msg)) return "RPC request failed";
  const s = msg.trim();
  // short plain sentences we wrote ourselves pass through; anything else is reduced to a fixed reason
  if (s && s.length <= 60 && /^[\w .,'()\-:/<>=+%#]+$/.test(s)) return s;
  return "request failed";
}

/** Strip URLs and key-like query params from free text that will be shown to a user. */
export function scrubText(s: string): string {
  return s
    .replace(URL_RE, "")
    .replace(SECRETISH_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
}

const NC_RE = /^(.*?):? not checked\b(?:\s*\((.*)\))?(.*)$/i;

function cleanLine(line: string): string {
  const m = NC_RE.exec(line);
  if (m && m[2] !== undefined && RAW_RE.test(m[2])) {
    return `${m[1]}: not checked (${safeReason(m[2])})`;
  }
  let out = RAW_RE.test(line) && /https?:\/\/|wss?:\/\//i.test(line) ? scrubText(line) : line;
  out = out.replace(SECRETISH_RE, "");
  if (/timed out/i.test(out) && !out.includes(INCOMPLETE)) {
    out = /\)$/.test(out) ? `${out.slice(0, -1)}, ${INCOMPLETE})` : `${out} (${INCOMPLETE})`;
  }
  return out;
}

function rank(line: string): number {
  if (/timed out/i.test(line)) return 3;
  if (/scan finished|request cancelled/i.test(line)) return 1;
  return 2;
}

/**
 * Sanitize and deduplicate "not checked" lines. Several lines about the same source (for example
 * "beacon validators: not checked (timed out after 12s)" and "beacon validators: not checked (scan finished)")
 * collapse to one, keeping the most specific reason: a timeout beats a generic "scan finished".
 */
export function tidyNotChecked(lines: readonly string[]): string[] {
  const out: string[] = [];
  const idx = new Map<string, number>();
  for (const raw of lines) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const line = cleanLine(raw);
    const m = NC_RE.exec(line);
    const key = m
      ? `nc:${m[1]!.trim().toLowerCase()}|${(m[3] ?? "")
          .replace(/\(.*\)/g, "")
          .trim()
          .toLowerCase()}`
      : `x:${line}`;
    const at = idx.get(key);
    if (at === undefined) {
      idx.set(key, out.length);
      out.push(line);
    } else if (rank(line) > rank(out[at]!)) out[at] = line;
  }
  return out;
}
