# Frontier Master Plan

## Purpose

Frontier is a system for producing actionable insights rooted in verifiable context.

Frontier is the durable knowledge and action system. It should be usable by any human, agent, app, or automation without depending on a specific interface.

The central thesis:

> Frontier is a timestamped graph of context, ingestion, synthesis, and actions.

## Product Boundary

Frontier owns the system of record.

Responsibilities:

- Store and version all records.
- Maintain Context, Ingestion, Synthesis, and Actions wikis.
- Track provenance between records.
- Manage sessions, artifacts, and timestamps.
- Run ingestion and synthesis workflows.
- Determine staleness and supersession.
- Expose a CLI and local API for humans, agents, and apps.
- Remain model-agnostic and interface-agnostic.

## Core Domains

### Context

Context is the system's durable goal framework.

It includes objectives, principles, constraints, definitions, preferences, strategy, operating assumptions, and baseline knowledge. Context should be carefully edited, version controlled, and treated as foundational.

### Ingestion

Ingestion is data brought into the system from any source.

Sources may include files, links, APIs, messages, databases, transcripts, images, research, notes, or other agents. Ingested data should be labeled, sorted, timestamped, indexed, and linked to its original source.

### Synthesis

Synthesis is the process of combining Context and Ingestion to create new value.

A synthesis run is an event. It records the prompt, goal, context versions, ingestion records, model, agent, session, timing, and generated outputs.

Synthesis does not equal the output. Synthesis produces one or many Actions.

### Actions

Actions are user-facing outputs produced by Synthesis.

Actions can be text, markdown, files, plans, tasks, research briefs, scripts, components, images, websites, content ideas, or any other useful artifact. Actions have their own wiki so the system can search, update, reuse, supersede, or trace them.

## Record Graph

Everything in Frontier should be represented as a timestamped record.

```ts
type RecordType =
  | "context"
  | "ingestion"
  | "synthesis"
  | "action"
  | "session"
  | "artifact"
  | "person"
  | "source"
  | "tag";
```

Baseline shape:

```ts
type Record = {
  id: string;
  projectId: string;
  type: RecordType;
  title: string;
  body?: string;
  payload?: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  observedAt?: string;
  validFrom?: string;
  validUntil?: string;
  version: number;
  status: string;
  tags: string[];
  links: RecordLink[];
};
```

Core relationship:

```text
Context + Ingestion
        |
        v
   Synthesis Run
        |
        v
 One or Many Actions
```

Every Action must be traceable back to:

- the Synthesis run that produced it
- the Context records and versions used
- the Ingestion records and versions used
- the Session where it was created
- the Agent and model used
- timestamps that support staleness judgments

## Wikis

Each major domain should have its own wiki. Wikis are first-class navigational surfaces for both humans and agents.

A Frontier wiki is not just a visual UI view. It is a readable map over the underlying record graph. Humans should be able to browse it to understand the project, and agents should be able to traverse it to gather the context they need before acting.

Each wiki should provide:

- stable paths and `@` references
- short human-readable summaries
- agent-readable structured metadata
- backlinks and forward links
- related records
- timestamps and version state
- freshness or staleness signals
- recommended next records to inspect
- canonical entry points for broad understanding

The rule:

> Wikis are the human and agent readable maps. The graph is the underlying data model.

### Context Wiki

Stores durable goals, strategy, definitions, principles, constraints, and preferences.

### Ingestion Wiki

Stores imported data, source documents, links, extracted entities, labels, summaries, and source metadata.

### Synthesis Wiki

Stores synthesis runs, reasoning summaries, dependency graphs, input records, output records, and run metadata.

### Actions Wiki

Stores produced outputs and makes it possible to avoid recreating work that should instead be updated.

The Actions Wiki should answer:

- Does a similar action already exist?
- Is the action stale?
- What synthesis produced it?
- What records grounded it?
- Should this be updated, superseded, or reused?

Agent navigation examples:

```bash
ft wiki list
ft wiki show context --json
ft wiki map context --depth 2 --json
ft wiki related @context/baseline-goals --json
ft wiki entrypoints --json
```

## Sessions

A session is the runtime container for interaction and the canonical working state for an agent or human operating Frontier.

Frontier owns sessions first-class. Sessions must work even when the surrounding app or interface has no native session support.

The mental model:

```text
cwd = current filesystem working directory
git branch = current version-control working state
Frontier session = current knowledge/action working state
```

Every new thread should create or attach to a Frontier session. A session remains active while there is activity and can later be resumed from the CLI or another agent environment.

A session includes:

- visible message history
- private agent activity logs
- referenced records
- current working record set
- attached files, images, and links
- synthesis runs initiated during the session
- actions created or edited during the session
- artifacts created or modified
- actor identity, such as human, Codex, Claude Code, script, or another interface
- timestamps for every meaningful event

Session layers:

```text
Conversation Log
  What the user and agent said.

Agent Activity Log
  What the agent did internally.

Artifact Log
  What changed in Context, Ingestion, Synthesis, or Actions.
```

Example CLI flow:

```bash
ft use "Acme Strategy"
ft session start "Messaging Work" --actor codex
ft session attach @context/baseline-goals
ft session attach @ingestion/customer-calls
ft session current --json
```

After a session is active, later Frontier commands should automatically attach reads, writes, synthesis runs, and actions to the current session unless another session is explicitly specified.

The ownership rule:

> Frontier owns canonical sessions. Interfaces may operate sessions, but no interface is required for sessions to work.

## CLI Strategy

The Frontier CLI is the universal control plane for the system of record.

It operates records, graph links, ingestion, synthesis, actions, sessions, provenance, and staleness.

The product is called Frontier. The canonical CLI command should be `ft`, with `frontier` available as an optional long alias.

Example:

```bash
ft init "Acme Strategy"
ft context add ./goals.md --title "Baseline Goals"
ft ingest url https://example.com --label competitor
ft synth run --context @context/goals --ingestion @ingestion/competitor
ft actions list --similar "pricing brief"
ft trace @action/pricing-brief
ft stale list
```

## Agent-Native CLI Principles

Frontier should learn from agent-first CLI systems such as Printing Press:

- Prefer compact, token-efficient output.
- Support structured `--json` output everywhere.
- Support compound commands that reduce agent round trips.
- Keep local mirrors and indexes where useful.
- Make common agent workflows first-class.
- Provide stable command contracts and schemas.
- Emit clear errors with suggested next commands.
- Separate human-pretty output from machine-stable output.

## Platform Direction

Recommended architecture:

```text
Frontier Core
  Go or Rust CLI
  SQLite local store
  full-text search
  local graph indexes
  optional local daemon

Frontier Interface
  CLI first
  local HTTP/WebSocket or stdio API
  agent adapter docs
```

## V0 Scope

The smallest compelling version:

1. Create and select Frontier projects.
2. Add versioned Context records.
3. Add Ingestion records with source metadata.
4. Run Synthesis records from selected Context and Ingestion.
5. Produce one or more Actions from each Synthesis run.
6. Store mandatory provenance links.
7. Search Actions before creating new ones.
8. Track timestamps and staleness.
9. Create Sessions with message, activity, and artifact logs.
10. Expose all core behavior through the Frontier CLI.

The first magical moment:

> Here is an output, and I can show exactly what goals, data, synthesis run, agent, and timestamps produced it.

## Open Questions

- Should Frontier storage be fully file-backed, SQLite-backed, or hybrid?
- Should Context records be edited as markdown files, database records, or both?
- What is the canonical link syntax for records?
- How should staleness be computed across linked records?
- How much of synthesis should be deterministic workflow versus agent-led reasoning?
- How should permissions work for shared Frontier projects?
