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
