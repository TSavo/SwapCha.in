import { describe, expect, it } from "vitest";
import { vmOfAddr } from "./intel.js";
describe("vmOfAddr", () => {
  it("only 32-byte base58 is svm", () => {
    expect(vmOfAddr("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe("svm");
    for (const a of ["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L", "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh", "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"])
      expect(vmOfAddr(a)).toBe("other");
    expect(vmOfAddr("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe("evm");
  });
});
