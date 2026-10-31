import { defineConfig } from "vitest/config";

// The api suite includes heavy wasm/crypto fuzz tests — the ABI-decode parity tests run hundreds of
// random calls through the vendored blocktools wasm. The default 5s is too tight under parallel
// workers, especially with the larger 0.3.x wasm, so give them room without masking real hangs.
export default defineConfig({ test: { testTimeout: 20000 } });
