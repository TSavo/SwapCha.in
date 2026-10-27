import { describe, expect, it } from "vitest";
import { initcodeStartsWith } from "./creationCheck";

const CODE = "0x6080604052";
const ARGS = "000000000000000000000000000000000000000000000000000000000000002a";

describe("initcodeStartsWith", () => {
  it("accepts exact bytecode and bytecode followed by constructor args", () => {
    expect(initcodeStartsWith(CODE, CODE)).toBe(true);
    expect(initcodeStartsWith(`${CODE}${ARGS}`, CODE)).toBe(true);
    expect(
      initcodeStartsWith(`${CODE}${ARGS}`.toUpperCase().replace("0X", "0x"), " 6080604052 "),
    ).toBe(true);
  });
  it("rejects bytecode that only appears later in the initcode", () => {
    expect(initcodeStartsWith(`0xdeadbeef${CODE.slice(2)}`, CODE)).toBe(false);
    expect(initcodeStartsWith(`0x00${CODE.slice(2)}${ARGS}`, CODE)).toBe(false);
  });
  it("rejects empty, non-hex, or longer pasted code", () => {
    expect(initcodeStartsWith(CODE, "")).toBe(false);
    expect(initcodeStartsWith(CODE, "0x")).toBe(false);
    expect(initcodeStartsWith(CODE, "0xzz")).toBe(false);
    expect(initcodeStartsWith(CODE, `${CODE}00`)).toBe(false);
    expect(initcodeStartsWith("6080604052", CODE)).toBe(false);
  });
});
