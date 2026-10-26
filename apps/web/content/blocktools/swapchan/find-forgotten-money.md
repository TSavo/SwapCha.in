# Find forgotten money across chains (blocktools + SwapChan)

You have an old seed phrase or wallet file. blocktools turns it into **public addresses** offline; SwapChan's `find_money` then looks for funds on those addresses. Keys never leave your machine.

1. **Offline, list your public addresses** with blocktools (sealed run, redacted output). Using the README's public test seed in `./in/seed.txt`:

        ./blocktools run 'seed-repair < /in/seed.txt | seed-to-master | derive --chain btc --count 1'
        ./blocktools run 'seed-repair < /in/seed.txt | seed-to-master | derive --chain eth --count 1'

   On v0.1.0 the README gives this JSON form for a plain address list:

        ... | derive --chain btc --count 1 --public-only | redact | jq -r 'select(.address)|[.chain+" "+.kind,.path,.address]|@tsv' > addresses.txt

   Not sure what your file is? `./blocktools run 'classify /in/FILE'` names it, and `recipes/recover.sh FILE - --goal addresses` picks the pipeline.

2. **Check balances (nothing signed).** `recipes/recover.sh FILE - --goal balance` keeps public addresses only and asks Esplora (btc/ltc/doge) or JSON-RPC (eth). Exit 0 = funds found, 4 = nothing found. See [Goal: check balance](/blocktools/recipes/goal-check-balance).

3. **Hand the public addresses to SwapChan.** Paste an address into [Find money](/find-money), or have your AI agent call the MCP tool `find_money`: ranked claims, idle stables, lending, approvals and dust, with short swap links.

4. **Before anything is signed,** your agent calls `verify_tx` (guard + simulation + plain-English summary), you sign in your own wallet, and `broadcast_tx` relays it. The loop SwapChan documents is: `recovery_guide` → public addresses → `find_money` → `verify_tx` → human signs locally → `broadcast_tx`.

Sources: blocktools README (worked examples, v0.1.0 note), recipes/README.md, recipes/goal-check-balance.md; SwapChan [/recover](/recover) and the [agent playbook](/agents/playbook).
