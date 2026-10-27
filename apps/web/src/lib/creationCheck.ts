/**
 * Creation send guard: the built initcode must START WITH the pasted bytecode (constructor args are appended after
 * it). A "contains" check would accept initcode that runs other code first.
 */
export function initcodeStartsWith(initcode: string, bytecode: string): boolean {
  const code = bytecode.trim().replace(/^0x/i, "").toLowerCase();
  const data = initcode.trim().toLowerCase();
  if (!code || !/^[0-9a-f]*$/.test(code) || !data.startsWith("0x")) return false;
  return data.slice(2).startsWith(code);
}
