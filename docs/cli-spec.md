# Frontier CLI Spec

## Name

`ft`

Long alias, planned: `frontier`

## One-liner

Project-local system of record for context, ingestion, synthesis, actions, sessions, and provenance.

## Usage

```text
ft [global flags] <command> [args]
```

## Global Flags

| Flag | Meaning |
| --- | --- |
| `-h`, `--help` | Show help and ignore other args. |
| `--version` | Print the CLI version to stdout. |
| `--json` | Print machine-readable JSON. |
| `--plain` | Print stable line-oriented text where supported. |
| `-q`, `--quiet` | Suppress non-JSON success output. |
| `-v`, `--verbose` | Reserved for more detailed diagnostics. |
| `--no-input` | Disable prompts. Frontier currently never prompts. |
| `--no-color` | Disable color. Frontier currently emits no color. |
| `--frontier-dir <path>` | Use a specific `.frontier` directory instead of cwd discovery. |

`--json` and `--plain` are mutually exclusive.

## Commands

```text
ft init <name> [--dry-run]
ft use <name>
ft projects [--json|--plain]
ft status [--json|--plain]

ft context add <file> [--title <title>] [--tags <refs>] [--dry-run]
ft context list [--json|--plain]
ft context show <ref> [--json]

ft ingest file <file> [--title <title>] [--tags <refs>] [--observed-at <iso>] [--dry-run]
ft ingest text <text>|--stdin --title <title> [--tags <refs>] [--observed-at <iso>] [--dry-run]
ft ingest list [--json|--plain]
ft ingest show <ref> [--json]

ft synth create --goal <goal> [--context <refs>] [--ingestion <refs>] [--summary <text>] [--prompt <text>] [--agent <name>] [--model <name>] [--dry-run]

ft actions create --type <type> --title <title> [--from-synthesis <ref>] --body <file-or-text|-> [--status <status>] [--dry-run]
ft actions list [--json|--plain]
ft actions show <ref> [--json]
ft actions search <query> [--json|--plain]

ft session start <title> [--actor <actor>] [--interface <name>] [--dry-run]
ft session current [--json|--plain]
ft session attach <ref> [--dry-run]
ft session refs [--json|--plain]
ft session context [--json]

ft wiki list [--json|--plain]
ft wiki show <domain> [--json]
ft wiki map <domain> [--json]
ft wiki entrypoints [--json]
ft wiki related <ref> [--json|--plain]

ft agent docs codex|claude [--json]
ft agent write codex|claude [--path AGENTS.md] [--force] [--dry-run]

ft trace <ref> [--json]
```

## I/O Contract

Primary command output goes to stdout. Diagnostics and errors go to stderr.

Human output is optimized for reading in a terminal. JSON output is for agents and scripts. Plain output is stable line-oriented text, usually one path or record ref per line.

Text bodies can be passed with stdin where supported:

```bash
cat notes.md | ft ingest text --stdin --title "Customer Notes" --json
cat brief.md | ft actions create --type markdown --title "Brief" --body - --json
```

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Runtime failure, such as missing project, missing record, or failed file operation. |
| `2` | Invalid usage, such as missing args, incompatible output modes, or unknown flags. |

## Safety Rules

Write commands support `--dry-run` where they change Frontier state or write files. Dry runs validate inputs and print the operation that would happen without updating `.frontier`, copying artifacts, or writing agent docs.

Frontier currently does not prompt. Future interactive commands must only prompt when stdin is a TTY and must fail fast under `--no-input`.

Future destructive commands must require an interactive confirmation, `--force`, or an explicit confirmation flag.

## Env And Config

Project discovery walks upward from cwd until it finds `.frontier/frontier.db`.

Legacy projects with `.frontier/frontier.json` are still discoverable and are migrated to `.frontier/frontier.db` on first use.

Current precedence:

```text
--frontier-dir > FRONTIER_DIR > cwd discovery
```

Planned precedence:

```text
flags > env vars > project .frontier/config.json > user config > defaults
```

## Examples

```bash
ft --version
ft status --json
ft projects --plain
ft init "Studio Strategy" --dry-run
ft session start "Initial Exploration" --actor codex
ft context add ./goals.md --title "Baseline Goals" --json
cat notes.md | ft ingest text --stdin --title "Customer Notes" --json
ft synth create --goal "Create messaging recommendations" --context @context/baseline-goals --ingestion @ingestion/customer-notes --json
cat recommendation.md | ft actions create --type markdown --title "Messaging Recommendations" --from-synthesis @synthesis/create-messaging-recommendations --body - --json
ft trace @action/messaging-recommendations --json
```
