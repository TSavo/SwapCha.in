/** Same-site redirect targets only. Rejects protocol-relative ("//x", "/\x"), backslashes and
 * control characters, which browsers normalise into cross-origin URLs. Fail closed: undefined. */
export function safeNext(next: string | undefined | null): string | undefined {
  if (!next || typeof next !== "string") return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return undefined;
  if (next.startsWith("https://swapchan.com/")) return next;
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return undefined;
}
