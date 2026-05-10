# Frontier Plan

## Definition

Frontier is the durable system of record for actionable insights rooted in verifiable context.

It stores a timestamped graph of records across Context, Ingestion, Synthesis, Actions, Sessions, Artifacts, People, Sources, and Tags. It exposes that graph through an agent-first CLI and, eventually, a local API.

Frontier should be interface-agnostic and usable by humans, agents, apps, and automations without depending on a specific app.

The product is named Frontier. The canonical CLI command is `ft`, with `frontier` available as an optional long alias.

## Product Goals

- Make every output traceable to its source context and data.
- Prevent unnecessary recreation of actions that should be updated.
- Give agents and humans a reliable shared memory system.
- Provide first-class support for timestamps, versions, staleness, and provenance.
- Make the CLI powerful enough for agents and pleasant enough for humans.
- Keep model providers interchangeable.

## Core Concepts

### Project

A Frontier project is a named knowledge/action system.

Example:

```bash
ft init "Studio Strategy"
ft use "Studio Strategy"
```

Each project owns records, indexes, sessions, artifacts, and configuration.

### Record

Everything is a record.

```ts
type Record = {
  id: string;
  type: RecordType;
  title: string;
  body?: string;
  payload?: unknown;
  createdAt: string;
  updatedAt: string;
  observedAt?: string;
  version: number;
  status: string;
  tags: string[];
  links: RecordLink[];
};
```

### Link

Links describe relationships between records.

Examples:

```ts
type LinkType =
  | "references"
  | "derived_from"
  | "produced_by"
  | "produced"
  | "supersedes"
  | "superseded_by"
  | "updates"
  | "similar_to"
  | "used_context"
  | "used_ingestion"
  | "created_in_session";
```

### Version

Every meaningful mutation creates a new version. Actions and Context records especially need clear version history.

### Timestamp

All records and events must include timestamps. Timestamp fields should distinguish:

- `createdAt`: when Frontier created the record
- `updatedAt`: when Frontier last changed the record
- `observedAt`: when the underlying real-world data was observed
- `validFrom`: when the content starts being valid
- `validUntil`: when the content should be considered expired

## Domain Wikis

Wikis are first-class, human and agent readable knowledge spaces.

They are the primary way humans and agents navigate a Frontier project. A wiki should make it easy to understand what exists, what matters, how records relate, what is stale, and what should be read next.

Wikis are built on top of the record graph. A wiki page may be a record, a generated index over records, or a curated entry point into a domain. The graph remains the source of truth, while the wiki gives that graph a readable structure.

Each wiki should support:

- stable paths
- `@` references
- summaries
- record metadata
- backlinks
- forward links
- related records
- version state
- freshness and staleness indicators
- recommended reading paths
- human-readable output
- agent-readable `--json` output

Core commands:

```bash
ft wiki list
ft wiki show context
ft wiki show context --json
ft wiki map actions --depth 2 --json
ft wiki related @action/pricing-brief --json
ft wiki entrypoints --json
```

Agent usage pattern:

1. Inspect the current session.
2. Read the relevant wiki entry points.
3. Traverse linked records.
4. Check timestamps and staleness.
5. Search for existing Actions before creating new ones.
6. Run Synthesis only after the relevant Context and Ingestion records are understood.

### Context Wiki

The Context Wiki stores foundational goals and durable knowledge.

Record examples:

- baseline goals
- company principles
- ideal customer profile
- positioning strategy
- constraints
- tone and brand rules
- operating assumptions

Context must be carefully edited and versioned.

### Ingestion Wiki

The Ingestion Wiki stores external and user-provided data.

Source examples:

- files
- URLs
- API responses
- transcripts
- images
- notes
- database snapshots
- chat excerpts
- agent-produced research

Ingestion should preserve source metadata and raw content when possible.

### Synthesis Wiki

The Synthesis Wiki stores synthesis runs.

A synthesis run records:

- goal
- prompt
- selected context records and versions
- selected ingestion records and versions
- agent
- model
- session
- start and completion timestamps
- generated action IDs
- reasoning summary
- error state, if any

### Actions Wiki

The Actions Wiki stores outputs created by synthesis.

Action types:

- `text`
- `markdown`
- `file`
- `task`
- `plan`
- `research`
- `script`
- `component`
- `image`
- `website`
- `dataset`

The Actions Wiki should be searched before creating a new action. When a similar action exists, Frontier should help decide whether to update, supersede, fork, or create a new action.

## Provenance

Provenance is mandatory for Actions.

Each Action must link to:

- its producing Synthesis run
- all Context records used, including versions
- all Ingestion records used, including versions
- the Session where it was created
- any artifacts created or edited

Trace example:

```bash
ft trace @action/pricing-brief
```

Expected output:

```text
Action: Pricing Brief v3
Produced by: Synthesis Run 2026-05-07 15:42
Session: session-184
Agent: codex
Model: gpt-5

Context:
  - Baseline Goals v4
  - Positioning Strategy v2

Ingestion:
  - Customer Calls April v1
  - Competitor Pricing Notes v1

Status:
  active

Staleness:
  caution: Customer Calls April is 31 days old
```

## Staleness

Staleness should be calculated from timestamps and dependency changes.

An Action may become stale when:

- a linked Context record has a newer version
- a linked Ingestion record has newer data
- its `validUntil` has passed
- a similar Action supersedes it
- a user marks it stale
- a configured freshness policy is violated

Statuses:

- `draft`
- `active`
- `needs_review`
- `needs_update`
- `superseded`
- `archived`

## Sessions

Frontier sessions capture interaction and work state. They are first-class Frontier records, not an interface-only concept.

A session should behave like a knowledge/action working directory. An agent using Codex, Claude Code, a shell, or another chat app should be able to enter a Frontier session and work coherently even when the surrounding app does not support sessions.

Mental model:

```text
cwd = current filesystem working directory
git branch = current version-control working state
Frontier session = current knowledge/action working state
```

Core commands:

```bash
ft use "Studio Strategy"
ft session start "Messaging Work" --actor codex
ft session current
ft session attach @context/baseline-goals
ft session attach @ingestion/customer-calls
ft session refs
```

When a session is active, Frontier commands should automatically log against that session by default:

```bash
ft context show @context/baseline-goals
ft ingest file ./customer-notes.md
ft synth run --goal "Create messaging recommendations"
ft actions create --from-synthesis @synthesis/latest
```

Each command should record:

- session ID
- timestamp
- actor identity
- command or event
- records read
- records created
- records updated
- artifacts created
- synthesis/action provenance

Agents should be able to recover working state with:

```bash
ft session current --json
ft session context --json
```

The session context should return the current project, active session, attached records, recent synthesis runs, recent actions, open questions, and artifact log.

Session records should include:

- session ID
- project ID
- interface source, such as CLI, script, or app
- agent identity
- participant identities
- message log
- activity log
- artifact log
- record references
- current working record set
- start and end timestamps

Frontier should persist a local current-session pointer per project. This could live in project configuration or as a small file inside `.frontier/`.

## CLI Design

The CLI should be both human-friendly and agent-native.

Command groups:

```bash
ft init
ft use
ft projects

ft context
ft ingest
ft synth
ft actions
ft wiki
ft session
ft artifacts
ft trace
ft stale
ft search
ft graph
```

Agent features:

- `--json` on all read commands
- `--compact` for token-efficient output
- `--explain` for human-readable command behavior
- stable exit codes
- schema version output
- batch commands
- compound workflows

Example:

```bash
ft synth run \
  --goal "Create a messaging brief" \
  --context @context/baseline-goals \
  --ingestion @ingestion/customer-calls \
  --check-existing-actions \
  --json
```

## Storage

Recommended V0:

- SQLite for records, links, events, and indexes.
- Markdown or JSON files for human-editable bodies where useful.
- Filesystem artifact storage for generated files and raw ingested assets.
- Full-text search through SQLite FTS.

Potential structure:

```text
.frontier/
  frontier.db
  config.json
  artifacts/
  raw/
  exports/
```

## Agent Integration

Frontier should expose agent instructions as generated docs.

Example:

```bash
ft agent docs codex
ft agent docs claude
```

These should teach an agent:

- how to search records
- how to reference records
- how to avoid duplicate actions
- how to run synthesis
- how to preserve provenance
- how to emit artifacts

## V0 Implementation Milestones

1. Project initialization and selection.
2. SQLite schema for records, links, events, and versions.
3. Context add/list/show/update commands.
4. Ingestion add/list/show commands for files, URLs, and text.
5. Action add/list/search/show/update commands.
6. Synthesis run records with manual output attachment.
7. Provenance trace command.
8. Session start/message/activity/artifact logging.
9. Staleness checks based on dependency versions and timestamps.
10. Agent docs and compact JSON output.

## Non-Goals for V0

- Full remote collaboration.
- Complex permissions.
- Full visual graph editing.
- Automatic ingestion from every possible source.
- Perfect synthesis orchestration.
- Provider-specific model management.
- Native UI concerns.
