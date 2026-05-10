#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTIER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FT="$FRONTIER_ROOT/bin/ft.mjs"

TARGET_DIR="${1:-$PWD}"
PROJECT_NAME="${2:-$(basename "$TARGET_DIR")}"
ACTOR="${FRONTIER_ACTOR:-agent}"

if ! command -v node >/dev/null 2>&1; then
  echo "Frontier setup requires Node.js to run the current MVP CLI." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

echo "Setting up Frontier in: $TARGET_DIR"

if [ ! -d ".frontier" ]; then
  node "$FT" init "$PROJECT_NAME"
else
  echo "Frontier project already exists."
fi

node "$FT" use "$PROJECT_NAME" >/dev/null

if node "$FT" session current --json | grep -q '"currentSession": null'; then
  node "$FT" session start "Initial Frontier Session" --actor "$ACTOR"
else
  echo "Frontier session already exists."
fi

node "$FT" agent write "$ACTOR" --path AGENTS.md --force

if [ -f "README.md" ]; then
  if ! node "$FT" context list --json | grep -q '"title": "Project README"'; then
    node "$FT" context add README.md --title "Project README"
  fi
fi

echo
echo "Frontier is ready."
echo
echo "Try:"
echo "  node $FT status"
echo "  node $FT session context --json"
echo "  node $FT wiki entrypoints --json"
echo
echo "Optional shell alias:"
echo "  alias ft='node $FT'"
