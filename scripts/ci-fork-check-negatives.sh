#!/bin/sh
# Negative tests for scripts/ci-fork-check.py (rules H-fork, H-forkperm, H-prt, H-push): each plant must FAIL the check.
set -eu
cd "$(dirname "$0")/.."
python3 scripts/ci-fork-check.py .github/workflows
rc=0
neg() {  # neg ID EXPECTED-SUBSTRING SED-EXPR
  d=$(mktemp -d); cp .github/workflows/*.yml "$d"/; sed -i "$3" "$d/ci.yml"
  if out=$(python3 scripts/ci-fork-check.py "$d" 2>&1); then echo "NEG $1: plant passed (expected failure)"; rc=1
  elif echo "$out" | grep -qF "$2"; then echo "neg $1 ok"; else echo "NEG $1: wrong failure: $out"; rc=1; fi
  rm -rf "$d"
}
neg H-fork "fork pull_request selects" "s/github.event.pull_request.head.repo.full_name == github.repository/true/"
neg H-forkperm "not read-only on pull_request" "s/^  contents: read$/  contents: write/"
neg H-noperm "not read-only on pull_request" "/^permissions:$/,/^  contents: read$/d"
neg H-prt "uses pull_request_target" "s/^  pull_request:$/  pull_request_target:/"
neg H-push "no longer selects self-hosted" "s/fromJSON('\[\"self-hosted\",\"Linux\",\"X64\",\"swapchan\"\]')/'ubuntu-latest'/"
exit $rc
