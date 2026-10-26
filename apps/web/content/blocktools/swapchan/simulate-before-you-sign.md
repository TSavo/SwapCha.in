# Simulate and verify before you sign

Two layers: SwapChan simulates an EVM transaction online; blocktools decodes and checks any transaction offline against what you expect.

1. **Simulate on SwapChan.** Open [Simulate](/simulate) or have your agent call the MCP tool `simulate_swap`: a dry run of a quote or raw tx showing balance changes, approvals and the revert reason. Before every signature, `verify_tx` adds a guard and a plain-English summary for the human.

2. **Decode it with blocktools.** `tx-decode` reads one transaction on stdin (hex/base64 raw tx, PSBT, EVM RLP):

        tx-decode --text < signed.json

   See [Decode a transaction before you sign or broadcast it](/blocktools/recipes/decode-a-transaction).

3. **Check it against what you expect.** `tx-verify` checks a transaction against an expected destination and maximum fee (example from recipes/goal-verify-and-offline.md):

        ./blocktools run 'tx-verify --expect-to 1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3 --max-fee 10000 < /in/block170.hex'

   In that example the check correctly fails (`input_amounts_unknown`): a raw transaction has no input amounts, so the fee is unknown. A PSBT from `tx-build` carries them, so the check can pass. An optional [policy file](/blocktools/docs/policy) caps fees and destinations before signing.

4. **A human signs.** `tx-sign` signs ONE transaction after a human reads its summary and types a code on /dev/tty; `tx-broadcast` asks for a second code. On SwapChan your own wallet signs; SwapChan never holds keys.

Sources: blocktools recipes/goal-verify-and-offline.md, recipes/decode-a-transaction.md, docs/getting-started.md, man pages for tx-decode / tx-verify / tx-sign; SwapChan [/simulate](/simulate) and the agent tool list.
