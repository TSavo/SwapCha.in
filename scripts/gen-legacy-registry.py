#!/usr/bin/env python3
"""Regenerate apps/api/src/legacy/registry.json.

Inputs (not committed): the CC0 LegacyETH open dataset (github.com/LegacyETHcom/legacyeth-open-data,
data/protocols.json + protocol_info.json) turned into the draft family table, and one confirmation run per
PR (one real holder per contract: view read > 0, then eth_simulateV1 of the claim from that holder pays exactly
that amount; amount-argument claims must also revert on a 1-wei overdraw). The per-wallet balance snapshot and
holder addresses are NOT copied: they are never an authority, only the on-chain read at scan time is.

Usage:
  gen-legacy-registry.py <draft.json> <out.json> <confirmations.json> [<confirmations.json> ...]
      draft rows: {key, name, addr, fam, eth, notes[]}
      confirmation file: {block, label?, results: [{addr, confirmed, claimFn, block?, view?, viewOn?, vault?}]}
      (label "Pr2", "Pr3", ... becomes the top-level confirmationBlock<label>; the first file has no label)
  gen-legacy-registry.py --check <registry.json>
      CI drift check: rebuilds the draft + confirmation inputs from registry.json, regenerates, and fails if the
      output differs byte for byte (so every family, per-row field and confirmation block is known here).
"""
import json, sys

# already scanned by dedicated code in intel.ts / refunds.ts / ensdeed.ts
ELSEWHERE = {"idex", "etherdelta", "ens_old", "fomo3d_long", "powh3d", "thedao"}
# families the scanner knows (must equal FAMILY_CLAIM in registry.ts + the burn/refund families in burnrefund.ts;
# checked by registry.test.ts)
SCANNED = {
    "etherdelta-dex", "fomo3d", "weth-wrapper", "ether-balances", "presale-safe-withdrawal", "hourglass",
    "refund-claim", "refund-crowdsale", "presale-pool", "presale-withdraw", "burn-token-for-eth",
    "pull-payment", "refund-withdraw", "sim-claim", "ethfinex-wrapper",
}
# per-row fields a confirmation may carry, in output order
CONF_FIELDS = ("view", "viewOn", "vault")
SOURCE = ("LegacyETH open dataset (CC0), github.com/LegacyETHcom/legacyeth-open-data @6b21442"
          " + legacyeth.com/contracts detail pages")


def build(R, confs, generated):
    ok = {}
    for C in confs:
        for r in C["results"]:
            if r["confirmed"]:
                ok[r["addr"].lower()] = dict(r, block=r.get("block", C["block"]))
    rows = []
    for r in R:
        c = ok.get(r["addr"].lower())
        fam = r["fam"]
        notes = [n for n in r["notes"] if n]
        e = {
            "key": r["key"].replace("site:", "site-").replace(" ", "-").lower(),
            "name": r["name"],
            "address": r["addr"],
            "family": fam,
            "listedEth": r["eth"],
        }
        if r["key"] in ELSEWHERE:
            e["status"] = "covered-elsewhere"
        elif c and fam in SCANNED:
            e["status"] = "confirmed"
            e["claim"] = c["claimFn"]
            e["confirmedAtBlock"] = c["block"]
            for k in CONF_FIELDS:
                if k in c:
                    e[k] = c[k]
        else:
            e["status"] = "not-checked"
        if fam == "fomo3d" or any("EOA" in n for n in notes):
            e["eoaOnly"] = True
        if any("owner" in n for n in notes):
            e["ownerGated"] = True
        if any("multi-step" in n for n in notes):
            e["multiStep"] = True
        rows.append(e)
    doc = {"source": SOURCE, "generated": generated, "confirmationBlock": confs[0]["block"]}
    for C in confs[1:]:
        doc["confirmationBlock" + C["label"]] = C["block"]
    doc["entries"] = rows
    return json.dumps(doc, indent=2) + "\n"


def inputs_from(doc):
    """Reverse of build(): the draft + confirmation inputs that reproduce a registry.json."""
    R, res = [], []
    for e in doc["entries"]:
        notes = []
        if e.get("eoaOnly") and e["family"] != "fomo3d":
            notes.append("EOA only")
        if e.get("ownerGated"):
            notes.append("owner-gated")
        if e.get("multiStep"):
            notes.append("multi-step")
        R.append({"key": e["key"], "name": e["name"], "addr": e["address"], "fam": e["family"],
                  "eth": e["listedEth"], "notes": notes})
        if e["status"] == "confirmed":
            res.append(dict({"addr": e["address"], "confirmed": True, "claimFn": e["claim"],
                             "block": e["confirmedAtBlock"]}, **{k: e[k] for k in CONF_FIELDS if k in e}))
    confs = [{"block": doc["confirmationBlock"], "results": res}]
    for k, v in doc.items():
        if k.startswith("confirmationBlock") and k != "confirmationBlock":
            confs.append({"block": v, "label": k[len("confirmationBlock"):], "results": []})
    return R, confs


def main(a):
    if a[:1] == ["--check"]:
        text = open(a[1] if len(a) > 1 else "apps/api/src/legacy/registry.json").read()
        doc = json.loads(text)
        known = set(doc) - {"source", "generated", "entries"} - {k for k in doc if k.startswith("confirmationBlock")}
        R, confs = inputs_from(doc)
        out = build(R, confs, doc["generated"])
        bad = [e["key"] for e in doc["entries"] if e["status"] == "confirmed" and e["family"] not in SCANNED]
        unknown = {k for e in doc["entries"] for k in e} - {
            "key", "name", "address", "family", "listedEth", "status", "claim", "confirmedAtBlock",
            "eoaOnly", "ownerGated", "multiStep", *CONF_FIELDS}
        if known or bad or unknown or out != text:
            print("registry.json drifted from scripts/gen-legacy-registry.py:",
                  {"topLevel": sorted(known), "unknownFamily": bad, "unknownFields": sorted(unknown),
                   "bytesDiffer": out != text}, file=sys.stderr)
            return 1
        print("registry.json matches the generator:", len(doc["entries"]),
              sum(e["status"] == "confirmed" for e in doc["entries"]), "confirmed")
        return 0
    if len(a) < 2:
        print("usage: gen-legacy-registry.py --check [registry.json] | DRAFT OUT [CONFIRMATIONS...]", file=sys.stderr)
        return 2
    draft, out, *confs = a
    text = build(json.load(open(draft)), [json.load(open(c)) for c in confs], "2026-10-26")
    open(out, "w").write(text)
    d = json.loads(text)["entries"]
    print(len(d), sum(x["status"] == "confirmed" for x in d))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
