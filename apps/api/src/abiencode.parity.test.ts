import { limitAppData } from "@swapchan/shared";
import {
  erc20Abi,
  getAddress,
  keccak256,
  parseAbi,
  toBytes,
  toHex,
  encodeFunctionData as vFn,
  encodeAbiParameters as vParams,
} from "viem";
import { describe, expect, it } from "vitest";
import { btAppDataHash, encodeAbiParameters, encodeFunctionData } from "./blocktools.js";

// Byte-for-byte parity: blocktools evmAbiEncode (via the drop-in wrappers) vs viem, which SwapChan used before.
let seed = 0x5eed1234;
const rnd = () => {
  seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
  return seed / 2 ** 32;
};
const ri = (n: number) => Math.floor(rnd() * n);
const bytes = (n: number) => toHex(Uint8Array.from({ length: n }, () => ri(256)));
type P = { type: string; name?: string; components?: P[] };
const leafTypes = () => {
  const k = ri(8);
  if (k === 0) return `uint${8 * (1 + ri(32))}`;
  if (k === 1) return `int${8 * (1 + ri(32))}`;
  if (k === 2) return "address";
  if (k === 3) return "bool";
  if (k === 4) return "bytes";
  if (k === 5) return "string";
  if (k === 6) return `bytes${1 + ri(32)}`;
  return "uint256";
};
const genType = (d: number): P => {
  const k = ri(10);
  if (d < 2 && k === 0)
    return {
      type: "tuple",
      components: Array.from({ length: 1 + ri(3) }, (_, i) => ({
        ...genType(d + 1),
        name: `c${i}`,
      })),
    };
  if (d < 2 && k === 1) {
    const t = genType(d + 1);
    return { ...t, type: `${t.type}[${ri(2) ? "" : 1 + ri(3)}]` };
  }
  return { type: leafTypes() };
};
const genVal = (p: P): unknown => {
  const arr = /^(.*)\[(\d*)\]$/.exec(p.type);
  if (arr)
    return Array.from({ length: arr[2] ? Number(arr[2]) : ri(4) }, () =>
      genVal({ ...p, type: arr[1]! }),
    );
  if (p.type === "tuple")
    return ri(2)
      ? Object.fromEntries((p.components ?? []).map((c) => [c.name, genVal(c)]))
      : (p.components ?? []).map(genVal);
  const m = /^(u?)int(\d+)$/.exec(p.type);
  if (m) {
    const bits = BigInt(m[2]!);
    const edge = ri(4);
    const max = m[1] ? 2n ** bits - 1n : 2n ** (bits - 1n) - 1n;
    const min = m[1] ? 0n : -(2n ** (bits - 1n));
    if (edge === 0) return max;
    if (edge === 1) return min;
    const r = BigInt(bytes(Number(bits) / 8)) % (max - min + 1n);
    return min + r;
  }
  if (p.type === "address") return ri(2) ? getAddress(bytes(20)) : bytes(20);
  if (p.type === "bool") return ri(2) === 1;
  if (p.type === "bytes") return bytes(ri(70));
  if (p.type === "string") return ["", "héllo ✓", "a".repeat(ri(100)), '"q"\\'][ri(4)];
  const n = /^bytes(\d+)$/.exec(p.type);
  return bytes(Number(n![1]));
};

describe("ABI encoding parity: blocktools vs viem", () => {
  it("2000 random function calls (nested tuples, arrays, every int width, edge values)", () => {
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const inputs = Array.from({ length: ri(5) }, (_, j) => ({ ...genType(0), name: `a${j}` }));
      const abi = [
        { type: "function", name: `f${i}`, inputs, outputs: [], stateMutability: "nonpayable" },
      ] as const;
      const args = inputs.map(genVal);
      expect(encodeFunctionData({ abi, args })).toBe(vFn({ abi, args } as never));
      expect(encodeAbiParameters(inputs, args)).toBe(vParams(inputs as never, args as never));
      n++;
    }
    expect(n).toBe(2000);
  });
  it("erc20 + overload selection by functionName/arity as used by call sites", () => {
    const to = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
    for (const [fn, args] of [
      ["approve", [to, 0n]],
      ["approve", [to, 2n ** 256n - 1n]],
      ["transfer", [to, 123456789n]],
      ["balanceOf", [to]],
      ["decimals", []],
      ["symbol", []],
    ] as const)
      expect(encodeFunctionData({ abi: erc20Abi, functionName: fn, args })).toBe(
        vFn({ abi: erc20Abi, functionName: fn, args } as never),
      );
    const ov = parseAbi(["function withdraw()", "function withdraw(uint256)", "function exit()"]);
    expect(encodeFunctionData({ abi: ov, functionName: "withdraw", args: [5n] })).toBe(
      vFn({ abi: ov, functionName: "withdraw", args: [5n] }),
    );
    expect(encodeFunctionData({ abi: ov, functionName: "withdraw" })).toBe(
      vFn({ abi: ov, functionName: "withdraw" }),
    );
  });
  it("rejects out-of-range values like viem", () => {
    const abi = parseAbi(["function f(uint8)"]);
    expect(() => encodeFunctionData({ abi, args: [256n] })).toThrow();
    expect(() => encodeFunctionData({ abi, args: [-1n] })).toThrow();
  });
  it("CoW appData hash matches viem keccak256(toBytes(doc)) on 300 docs", () => {
    for (let i = 0; i < 300; i++) {
      const doc = i % 3 ? limitAppData(getAddress(bytes(20)), i % 50) : `{"x":"${"é✓".repeat(i)}"}`;
      expect(btAppDataHash(doc)).toBe(keccak256(toBytes(doc)));
    }
  });
});
