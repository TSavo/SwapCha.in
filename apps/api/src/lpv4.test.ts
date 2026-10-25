import { describe, expect, it } from "vitest";
import { amountsFor, sqrtAtTick, unpackInfo, v4ExitTx } from "./lpv4.js";
import { verifyRecovery } from "./recover.js";
const own = "0x1111111111111111111111111111111111111111" as const;
const bad = "0x2222222222222222222222222222222222222222" as const;
describe("uniswap v4", () => {
  it("tick math matches TickMath constants", () => {
    expect(sqrtAtTick(0)).toBe(2n ** 96n);
    expect(sqrtAtTick(-887272)).toBe(4295128739n);
    expect(sqrtAtTick(887272)).toBe(1461446703485210103287273052203988822378723970342n);
  });
  it("amounts in/out of range", () => {
    const a = sqrtAtTick(-600), b = sqrtAtTick(600);
    expect(amountsFor(10n ** 18n, sqrtAtTick(-1000), a, b)[1]).toBe(0n);
    expect(amountsFor(10n ** 18n, sqrtAtTick(1000), a, b)[0]).toBe(0n);
    const [x, y] = amountsFor(10n ** 18n, 2n ** 96n, a, b);
    expect(x > 0n && y > 0n).toBe(true);
  });
  it("unpacks signed ticks", () => {
    const enc = (t: number) => BigInt(t < 0 ? t + 0x1000000 : t);
    expect(unpackInfo((enc(-120) << 8n) | (enc(240) << 32n))).toEqual({ tickLower: -120, tickUpper: 240 });
  });
  it("exit tx verifies only when taking to owner", () => {
    const tx = v4ExitTx(1, "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", 5n, 10n, "0x0000000000000000000000000000000000000000", own, own, [100n, 200n]);
    expect(verifyRecovery(tx, own).verified).toBe(true);
    const evil = v4ExitTx(1, "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", 5n, 10n, own, own, bad, [100n, 200n]);
    expect(verifyRecovery(evil, own).verified).toBe(false);
  });
});
