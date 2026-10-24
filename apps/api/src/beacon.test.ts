import { describe, expect, it } from "vitest";
import { classify } from "./beacon.js";
const o = "0x" + "ab".repeat(20);
describe("beacon classify", () => {
  it("0x00 is stuck", () => expect(classify("active_ongoing", "0x00" + "11".repeat(31), o).stuck).toBe(true));
  it("exited 0x01 sweeps", () => expect(classify("withdrawal_possible", "0x01" + "00".repeat(11) + "ab".repeat(20), o).action).toMatch(/this wallet/));
  it("active 0x01 to owner offers 7002", () => expect(classify("active_ongoing", "0x01" + "00".repeat(11) + "ab".repeat(20), o).action).toMatch(/7002/));
});
