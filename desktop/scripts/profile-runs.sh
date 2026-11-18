#!/bin/sh
# Baseline/after for one slice: scripts/profile-runs.sh <label> <runs> [<packaged executable>]
set -e; cd "$(dirname "$0")/.."
for i in $(seq 1 "$2"); do rm -rf "perf/$1/run-$i"; node scripts/profile.mjs "$3" "perf/$1/run-$i" >/dev/null 2>&1 || true; done
node scripts/profile-summary.mjs perf/$1/run-* | tee "perf/$1/summary.md"
