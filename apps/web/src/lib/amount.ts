import { formatUnits, parseUnits } from "viem";

const DECIMAL_RE = /^\d*\.?\d*$/;

/** Sanitize typed input: digits and a single dot only. */
export const sanitizeAmountInput = (raw: string): string => {
  const cleaned = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  return rest.length ? `${whole}.${rest.join("")}` : whole;
};

/**
 * Parse a user-typed decimal into base units. Returns null for empty/invalid/zero
 * input or when it has more fractional digits than the token supports.
 */
export const parseAmount = (input: string, decimals: number): bigint | null => {
  const s = input.trim();
  if (!s || s === "." || !DECIMAL_RE.test(s)) return null;
  const frac = s.split(".")[1] ?? "";
  if (frac.length > decimals) return null;
  const normalized = s.startsWith(".") ? `0${s}` : s.endsWith(".") ? s.slice(0, -1) : s;
  const v = parseUnits(normalized, decimals);
  return v > 0n ? v : null;
};

/** Format base units for display, truncating (never rounding up) to maxFrac digits. */
export const formatAmount = (value: bigint | string, decimals: number, maxFrac = 6): string => {
  const full = formatUnits(BigInt(value), decimals);
  const [w, f = ""] = full.split(".");
  const t = f.slice(0, maxFrac).replace(/0+$/, "");
  const whole = (w ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return t ? `${whole}.${t}` : whole;
};

export const formatUsd = (n: number | null): string =>
  n === null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export const formatEta = (s: number): string =>
  s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
