/**
 * Analytics URL sanitiser. GA must never see wallet addresses, ENS/SNS names, tx hashes, partner ids
 * or tokens, so: drop query and hash, redact the id segment of dynamic routes, and redact any segment
 * that looks like an address/hash/name. Plain ES5, no outside references: layout.tsx inlines it
 * via toString() so the very first hit is already sanitised.
 */
export function sanitizeGaUrl(href: string): string {
  var m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)/i.exec(href || "") || ["", "", ""];
  var origin = m[1] || "";
  var segs = (m[2] || "").split("/").filter(function (s) {
    return s.length > 0;
  });
  var idAt: Record<string, number> = {
    dashboard: 1,
    wallet: 1,
    airdrops: 1,
    "bridge-status": 1,
    partners: 1,
    s: 1,
    contract: 2,
    token: 2,
  };
  var cut = idAt[segs[0] || ""];
  var out: string[] = [];
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i] || "";
    var d = s;
    try {
      d = decodeURIComponent(s);
    } catch (e) {}
    var risky =
      (cut !== undefined && i >= cut) ||
      /^0x/i.test(d) ||
      /[.@:%]/.test(d) ||
      /^[0-9a-f]{20,}$/i.test(d) ||
      /^[1-9A-HJ-NP-Za-km-z]{20,}$/.test(d) ||
      /^(bc1|ltc1|tb1|bitcoincash:)/i.test(d);
    out.push(risky ? ":id" : s);
  }
  return origin + "/" + out.join("/");
}

/** Custom-event params for GA: drop anything address- or hash-like (keys or values). */
export function gaParams(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (/hash|address|owner|recipient|wallet|taker|uid/i.test(k)) continue;
    if (
      typeof v === "string" &&
      (/0x[0-9a-f]{20,}/i.test(v) ||
        /[1-9A-HJ-NP-Za-km-z]{25,}/.test(v) ||
        /\.(eth|sol|base\.eth)\b/i.test(v) ||
        /\b(bc1|ltc1)[0-9a-z]{20,}/i.test(v))
    )
      continue;
    out[k] = v;
  }
  return out;
}
