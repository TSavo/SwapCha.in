#!/usr/bin/env python3
"""Regenerate apps/api/src/legacy/registry.json.

Inputs (not committed): the CC0 LegacyETH open dataset (github.com/LegacyETHcom/legacyeth-open-data,
data/protocols.json + protocol_info.json), the draft family table, and the confirmation run
(one real holder per contract: view read > 0, then eth_call of the claim from that holder succeeds;
DEX: an overdraw by 1 ETH must revert). The per-wallet balance snapshot is NOT copied: it is never an
authority, only the on-chain read at scan time is.
Usage: gen-legacy-registry.py <draft.json> <confirmations.json> <out.json>
"""
import json, sys
draft, conf, out = sys.argv[1:4]
R = json.load(open(draft)); C = json.load(open(conf))
ok = {r["addr"].lower(): r for r in C["results"] if r["confirmed"]}
# already scanned by dedicated code in intel.ts / refunds.ts / ensdeed.ts
ELSEWHERE = {"idex", "etherdelta", "ens_old", "fomo3d_long", "powh3d", "thedao"}
FAM = {"etherdelta-dex": "etherdelta-dex", "fomo3d": "fomo3d"}
rows = []
for r in R:
    c = ok.get(r["addr"].lower())
    fam = r["fam"]
    e = {
        "key": r["key"].replace("site:", "site-").replace(" ", "-").lower(),
        "name": r["name"],
        "address": r["addr"],
        "family": FAM.get(fam, fam),
        "listedEth": r["eth"],
    }
    notes = [n for n in r["notes"] if n]
    if r["key"] in ELSEWHERE:
        e["status"] = "covered-elsewhere"
    elif c and fam in FAM:
        e["status"] = "confirmed"
        e["claim"] = c["claimFn"]
        e["confirmedAtBlock"] = C["block"]
    else:
        e["status"] = "not-checked"
    if fam == "fomo3d" or any("EOA" in n for n in notes):
        e["eoaOnly"] = True
    if any("owner" in n for n in notes):
        e["ownerGated"] = True
    if any("multi-step" in n for n in notes):
        e["multiStep"] = True
    rows.append(e)
doc = {
    "source": "LegacyETH open dataset (CC0), github.com/LegacyETHcom/legacyeth-open-data @6b21442 + legacyeth.com/contracts detail pages",
    "generated": "2026-10-26",
    "confirmationBlock": C["block"],
    "entries": rows,
}
open(out, "w").write(json.dumps(doc, indent=2) + "\n")
print(len(rows), sum(x["status"] == "confirmed" for x in rows))
