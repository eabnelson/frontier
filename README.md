# Frontier

Frontier is a CLI-first system of record for producing actionable insights rooted in verifiable context.

The product is named Frontier. The canonical CLI command is `ft`, with `frontier` available as a future long alias.

## Local Usage

Frontier requires Node.js 24 or newer for the built-in SQLite runtime.

This repository currently ships the CLI as a dependency-free Node script backed by project-local SQLite storage.

```bash
node ./bin/ft.mjs --help
node ./bin/ft.mjs --version
```

You can also run it through npm:

```bash
npm run ft -- --help
```

## Set Up Another Project

Use the setup guide and script:

- [Getting Started](./docs/getting-started.md)

```bash
./scripts/setup-frontier-project.sh /path/to/project "Project Name"
```

## First Project Loop

```bash
node ./bin/ft.mjs init "Studio Strategy"
node ./bin/ft.mjs session start "Initial Exploration" --actor codex

node ./bin/ft.mjs context add ./goals.md --title "Baseline Goals"
node ./bin/ft.mjs ingest file ./notes.md --title "Customer Notes"

node ./bin/ft.mjs synth create \
  --goal "Create messaging recommendations" \
  --context @context/baseline-goals \
  --ingestion @ingestion/customer-notes

node ./bin/ft.mjs actions create \
  --type markdown \
  --title "Messaging Recommendations" \
  --from-synthesis @synthesis/create-messaging-recommendations \
  --body "Recommend clearer pricing language."

node ./bin/ft.mjs trace @action/messaging-recommendations
```

## Storage

Frontier uses a project-local SQLite store:

```text
.frontier/
  frontier.db
  config.json
  artifacts/
  raw/
```

Existing `.frontier/frontier.json` stores are migrated to SQLite automatically on first use.

## CLI Contract

The command surface is documented in [CLI Spec](./docs/cli-spec.md). In short:

- Primary output goes to stdout; diagnostics and errors go to stderr.
- Use `--json` for agent-readable output.
- Use `--plain` for stable line-oriented output where supported.
- Invalid usage exits `2`; runtime failures exit `1`.
- Write commands support `--dry-run` where they mutate Frontier state or files.
