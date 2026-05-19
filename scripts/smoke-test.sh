#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FT="$ROOT_DIR/bin/ft.mjs"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/frontier-smoke.XXXXXX")"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

cd "$WORK_DIR"

node "$FT" init "Smoke Project" --json >/dev/null
test -f "$WORK_DIR/.frontier/frontier.db"

node "$FT" session start "Smoke Session" --actor test --json >/dev/null

printf 'Goal: keep knowledge traceable.\n' > goals.md
printf 'Observation: SQLite storage is active.\n' > notes.md

node "$FT" context add ./goals.md --title "Baseline Goals" --json >/dev/null
node "$FT" ingest file ./notes.md --title "Customer Notes" --json >/dev/null
node "$FT" synth create \
  --goal "Create smoke recommendation" \
  --context @context/baseline-goals \
  --ingestion @ingestion/customer-notes \
  --json >/dev/null
node "$FT" actions create \
  --type markdown \
  --title "Smoke Recommendation" \
  --from-synthesis @synthesis/create-smoke-recommendation \
  --body "Frontier smoke test passed." \
  --json >/dev/null

node "$FT" trace @action/smoke-recommendation --json | grep -q '"producedBy"'
node "$FT" actions search smoke --json | grep -q '@action/smoke-recommendation'
node "$FT" status --json | grep -q '"records": 5'
node "$FT" --json status | grep -q '"records": 5'

FIRST_DUPLICATE="$(node "$FT" ingest text "First duplicate body." --title "Repeated Note" --json)"
SECOND_DUPLICATE="$(node "$FT" ingest text "Second duplicate body." --title "Repeated Note" --json)"
node -e '
  const first = JSON.parse(process.argv[1]);
  const second = JSON.parse(process.argv[2]);
  if (first.ref !== "@ingestion/repeated-note") process.exit(1);
  if (second.ref !== "@ingestion/repeated-note-2") process.exit(1);
' "$FIRST_DUPLICATE" "$SECOND_DUPLICATE"

CONCURRENT_DIR="$WORK_DIR/concurrent"
mkdir -p "$CONCURRENT_DIR"
cd "$CONCURRENT_DIR"
node "$FT" init "Concurrent Project" --json >/dev/null
for index in 1 2 3 4 5 6 7 8; do
  node "$FT" ingest text "Concurrent body $index." --title "Concurrent Note $index" --json >/dev/null &
done
wait
CONCURRENT_STATUS="$(node "$FT" status --json)"
node -e '
  const status = JSON.parse(process.argv[1]);
  if (status.records !== 8) process.exit(1);
  if (status.events !== 8) process.exit(1);
' "$CONCURRENT_STATUS"

LEGACY_DIR="$WORK_DIR/legacy"
mkdir -p "$LEGACY_DIR/.frontier"
node -e '
  const fs = require("node:fs");
  const timestamp = new Date().toISOString();
  fs.writeFileSync(process.argv[1], `${JSON.stringify({
    schemaVersion: 1,
    project: {
      id: "project_legacy-project",
      name: "Legacy Project",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    currentSessionId: null,
    records: [],
    links: [],
    events: [],
    counters: {
      context: 0,
      ingestion: 0,
      synthesis: 0,
      action: 0,
      session: 0,
      artifact: 0
    },
    createdAt: timestamp,
    updatedAt: timestamp
  }, null, 2)}\n`);
' "$LEGACY_DIR/.frontier/frontier.json"
cd "$LEGACY_DIR"
node "$FT" status --json | grep -q '"project": "Legacy Project"'
test -f "$LEGACY_DIR/.frontier/frontier.db"

echo "Frontier CLI smoke test passed."
