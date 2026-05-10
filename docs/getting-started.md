# Getting Started with Frontier

This guide shows how to set up a project so humans and agents can use Frontier through the `ft` CLI.

Frontier requires Node.js 24 or newer for the built-in SQLite runtime.

Frontier is project-local in the current MVP. Running setup inside a project creates:

```text
.frontier/
  frontier.db
  config.json
  artifacts/
  raw/

AGENTS.md
```

`AGENTS.md` teaches Codex, Claude Code, and similar agents how to use Frontier as the project system of record.

## Quick Setup

From this Frontier repository:

```bash
./scripts/setup-frontier-project.sh /path/to/project "Project Name"
```

Example:

```bash
./scripts/setup-frontier-project.sh ~/Studio/acme "Acme Strategy"
```

The script will:

1. Create a project-local `.frontier/` store if one does not exist.
2. Start an initial Frontier session if one does not exist.
3. Write `AGENTS.md` with Frontier agent instructions.
4. Add `README.md` as Context if the target project has one.

## Manual Setup

From the target project:

```bash
node /Users/erik/Studio/studiofour/frontier/bin/ft.mjs init "Project Name"
node /Users/erik/Studio/studiofour/frontier/bin/ft.mjs session start "Initial Frontier Session" --actor codex
node /Users/erik/Studio/studiofour/frontier/bin/ft.mjs agent write codex --path AGENTS.md
```

Optional shell alias:

```bash
alias ft='node /Users/erik/Studio/studiofour/frontier/bin/ft.mjs'
```

After that, from the target project:

```bash
ft status
ft session context --json
ft wiki entrypoints --json
```

## Give This to an Agent

Once `AGENTS.md` exists in the project, tell the agent:

```text
Use Frontier for this project. Read AGENTS.md, then run:

ft status --json
ft session current --json
ft session context --json
ft wiki entrypoints --json
```

If `ft` is not globally available, give the agent the full command:

```bash
node /Users/erik/Studio/studiofour/frontier/bin/ft.mjs status --json
```

## First Useful Loop

```bash
ft context add ./goals.md --title "Baseline Goals"
ft ingest file ./notes.md --title "Customer Notes"

ft synth create \
  --goal "Create messaging recommendations" \
  --context @context/baseline-goals \
  --ingestion @ingestion/customer-notes

ft actions create \
  --type markdown \
  --title "Messaging Recommendations" \
  --from-synthesis @synthesis/create-messaging-recommendations \
  --body ./messaging-recommendations.md

ft trace @action/messaging-recommendations
```

## Agent Rules

Agents should:

- Treat Frontier as the source of truth.
- Use `--json` for read commands.
- Inspect session context and wiki entrypoints before acting.
- Search existing Actions before creating new ones.
- Create or identify a Synthesis record before creating Actions.
- Link every Action back to its Synthesis record.
- Run `ft trace` after creating or updating an Action.

## Current MVP Limits

- Storage is project-local SQLite at `.frontier/frontier.db`.
- Legacy `.frontier/frontier.json` stores are migrated automatically on first use.
- `ft` is not globally installed unless you add an alias or npm link.
- Staleness checks are planned but not implemented.
- Action updates are planned but not implemented.
