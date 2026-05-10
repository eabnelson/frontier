#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { cwd, exit, stdin } from "node:process";
import { DatabaseSync } from "node:sqlite";

const FRONTIER_DIR = ".frontier";
const STORE_FILE = "frontier.db";
const LEGACY_STORE_FILE = "frontier.json";
const PACKAGE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const CLI_VERSION = PACKAGE.version;

const RECORD_TYPES = new Set(["context", "ingestion", "synthesis", "action", "session", "artifact"]);
const GLOBAL_FLAGS = new Set(["help", "h", "version", "json", "plain", "quiet", "q", "verbose", "v", "noInput", "noColor", "frontierDir"]);

function now() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "untitled";
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && !arg.startsWith("--")) {
      if (arg.length !== 2) die(`unknown short flag: ${arg}`, 2);
      const key = arg.slice(1);
      if (!["h", "q", "v"].includes(key)) die(`unknown short flag: ${arg}`, 2);
      flags[key] = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positional, flags };
}

function print(data, flags) {
  if ((flags.quiet || flags.q) && !flags.json) return;
  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (flags.plain) {
    console.log(formatPlain(data));
    return;
  }

  if (typeof data === "string") {
    console.log(data);
    return;
  }

  console.log(format(data));
}

function format(data, indent = 0) {
  if (Array.isArray(data)) {
    if (data.length === 0) return "(none)";
    return data.map((item) => format(item, indent)).join("\n");
  }

  if (data && typeof data === "object") {
    return Object.entries(data)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          const list = value.length ? value.map((item) => `\n${" ".repeat(indent + 2)}- ${format(item, indent + 4).replace(/\n/g, `\n${" ".repeat(indent + 4)}`)}`).join("") : " (none)";
          return `${" ".repeat(indent)}${key}:${list}`;
        }
        if (value && typeof value === "object") {
          return `${" ".repeat(indent)}${key}:\n${format(value, indent + 2)}`;
        }
        return `${" ".repeat(indent)}${key}: ${value ?? ""}`;
      })
      .join("\n");
  }

  return String(data ?? "");
}

function formatPlain(data) {
  if (Array.isArray(data)) {
    return data.map((item) => formatPlain(item)).filter(Boolean).join("\n");
  }
  if (data && typeof data === "object") {
    if (data.ref) return data.ref;
    if (data.path) return data.path;
    if (data.message) return data.message;
    return JSON.stringify(data);
  }
  return String(data ?? "");
}

function die(message, code = 1) {
  console.error(`ft: ${message}`);
  exit(code);
}

function frontierPath(start = cwd()) {
  if (process.env.FRONTIER_DIR) {
    const envPath = resolve(process.env.FRONTIER_DIR);
    if (storeExists(envPath)) return envPath;
  }
  let dir = resolve(start);
  while (true) {
    const candidate = join(dir, FRONTIER_DIR);
    if (storeExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function storeExists(frontierDir) {
  return existsSync(join(frontierDir, STORE_FILE)) || existsSync(join(frontierDir, LEGACY_STORE_FILE));
}

function requireFrontier() {
  const path = frontierPath();
  if (!path) die("no Frontier project found. Run `ft init \"Project Name\"` first.");
  return path;
}

function loadStore(required = true) {
  const path = required ? requireFrontier() : frontierPath();
  if (!path) return null;
  const storePath = join(path, STORE_FILE);
  if (!existsSync(storePath) && existsSync(join(path, LEGACY_STORE_FILE))) {
    const legacyData = JSON.parse(readFileSync(join(path, LEGACY_STORE_FILE), "utf8"));
    saveSqliteStore(storePath, legacyData);
  }
  return {
    dir: path,
    storePath,
    data: loadSqliteStore(storePath),
  };
}

function saveStore(loaded) {
  loaded.data.updatedAt = now();
  saveSqliteStore(loaded.storePath, loaded.data);
}

function maybeSaveStore(loaded, flags) {
  if (flags.dryRun) return;
  saveStore(loaded);
}

function initialStore(name) {
  const timestamp = now();
  return {
    schemaVersion: 1,
    project: {
      id: `project_${slugify(name)}`,
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
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
      artifact: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function openDatabase(storePath) {
  const db = new DatabaseSync(storePath);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  ensureSchema(db);
  return db;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counters (
      type TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      ref TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      observed_at TEXT,
      valid_from TEXT,
      valid_until TEXT,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_records_type ON records(type);
    CREATE INDEX IF NOT EXISTS idx_records_ref ON records(ref);

    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      type TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(from_id, to_id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_id);
    CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_id);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  `);
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  return JSON.parse(value);
}

function loadSqliteStore(storePath) {
  const db = openDatabase(storePath);
  try {
    const metaRows = db.prepare("SELECT key, value FROM meta").all();
    const meta = Object.fromEntries(metaRows.map((row) => [row.key, parseJsonField(row.value, row.value)]));
    if (!meta.project) die(`invalid Frontier store: missing project metadata in ${storePath}`);

    const records = db
      .prepare("SELECT * FROM records ORDER BY rowid")
      .all()
      .map((row) => ({
        id: row.id,
        ref: row.ref,
        type: row.type,
        title: row.title,
        body: row.body,
        payload: parseJsonField(row.payload_json, {}),
        metadata: parseJsonField(row.metadata_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        observedAt: row.observed_at,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        version: row.version,
        status: row.status,
        tags: parseJsonField(row.tags_json, []),
      }));

    const links = db
      .prepare("SELECT * FROM links ORDER BY rowid")
      .all()
      .map((row) => ({
        id: row.id,
        fromId: row.from_id,
        toId: row.to_id,
        type: row.type,
        metadata: parseJsonField(row.metadata_json, {}),
        createdAt: row.created_at,
      }));

    const events = db
      .prepare("SELECT * FROM events ORDER BY rowid")
      .all()
      .map((row) => ({
        id: row.id,
        type: row.type,
        sessionId: row.session_id,
        createdAt: row.created_at,
        ...parseJsonField(row.payload_json, {}),
      }));

    const counters = Object.fromEntries(db.prepare("SELECT type, value FROM counters").all().map((row) => [row.type, row.value]));

    return {
      schemaVersion: meta.schemaVersion || 2,
      project: meta.project,
      currentSessionId: meta.currentSessionId || null,
      records,
      links,
      events,
      counters,
      createdAt: meta.createdAt || meta.project.createdAt,
      updatedAt: meta.updatedAt || meta.project.updatedAt,
    };
  } finally {
    db.close();
  }
}

function saveSqliteStore(storePath, store) {
  const db = openDatabase(storePath);
  const eventPayload = (event) => {
    const { id, type, sessionId, createdAt, ...payload } = event;
    return payload;
  };
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec("DELETE FROM events; DELETE FROM links; DELETE FROM records; DELETE FROM counters; DELETE FROM meta;");

    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries({
      schemaVersion: 2,
      project: store.project,
      currentSessionId: store.currentSessionId,
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
    })) {
      insertMeta.run(key, JSON.stringify(value));
    }

    const insertCounter = db.prepare("INSERT INTO counters (type, value) VALUES (?, ?)");
    for (const [type, value] of Object.entries(store.counters || {})) insertCounter.run(type, value);

    const insertRecord = db.prepare(`
      INSERT INTO records (
        id, ref, type, title, body, payload_json, metadata_json, created_at, updated_at,
        observed_at, valid_from, valid_until, version, status, tags_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const record of store.records || []) {
      insertRecord.run(
        record.id,
        record.ref,
        record.type,
        record.title,
        record.body || "",
        JSON.stringify(record.payload || {}),
        JSON.stringify(record.metadata || {}),
        record.createdAt,
        record.updatedAt,
        record.observedAt || null,
        record.validFrom || null,
        record.validUntil || null,
        record.version,
        record.status,
        JSON.stringify(record.tags || []),
      );
    }

    const insertLink = db.prepare("INSERT INTO links (id, from_id, to_id, type, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const link of store.links || []) {
      insertLink.run(link.id, link.fromId, link.toId, link.type, JSON.stringify(link.metadata || {}), link.createdAt);
    }

    const insertEvent = db.prepare("INSERT INTO events (id, type, session_id, created_at, payload_json) VALUES (?, ?, ?, ?, ?)");
    for (const event of store.events || []) {
      insertEvent.run(event.id, event.type, event.sessionId || null, event.createdAt, JSON.stringify(eventPayload(event)));
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function nextId(store, type, title) {
  store.counters[type] = (store.counters[type] || 0) + 1;
  const prefixes = {
    context: "ctx",
    ingestion: "ing",
    synthesis: "syn",
    action: "act",
    session: "ses",
    artifact: "art",
  };
  return `${prefixes[type]}_${slugify(title)}_${store.counters[type]}`;
}

function addEvent(store, type, payload = {}) {
  const event = {
    id: `evt_${store.events.length + 1}`,
    type,
    sessionId: store.currentSessionId,
    createdAt: now(),
    ...payload,
  };
  store.events.push(event);
  return event;
}

function createRecord(store, type, attrs) {
  if (!RECORD_TYPES.has(type)) die(`unknown record type: ${type}`);
  const timestamp = now();
  const record = {
    id: attrs.id || nextId(store, type, attrs.title),
    ref: attrs.ref || null,
    type,
    title: attrs.title,
    body: attrs.body || "",
    payload: attrs.payload || {},
    metadata: attrs.metadata || {},
    createdAt: timestamp,
    updatedAt: timestamp,
    observedAt: attrs.observedAt || null,
    validFrom: attrs.validFrom || null,
    validUntil: attrs.validUntil || null,
    version: 1,
    status: attrs.status || "active",
    tags: attrs.tags || [],
  };
  record.ref = record.ref || `@${type}/${slugify(record.title)}`;
  store.records.push(record);
  addEvent(store, "record.created", { recordId: record.id, recordRef: record.ref, recordType: type });
  return record;
}

function addLink(store, fromId, toId, type, metadata = {}) {
  const existing = store.links.find((link) => link.fromId === fromId && link.toId === toId && link.type === type);
  if (existing) return existing;
  const link = {
    id: `lnk_${store.links.length + 1}`,
    fromId,
    toId,
    type,
    metadata,
    createdAt: now(),
  };
  store.links.push(link);
  addEvent(store, "link.created", { linkId: link.id, fromId, toId, linkType: type });
  return link;
}

function findRecord(store, refOrId) {
  if (!refOrId) return null;
  if (refOrId === "@session/current") return store.records.find((record) => record.id === store.currentSessionId) || null;
  const raw = refOrId.startsWith("@") ? refOrId : refOrId.replace(/^#/, "");
  return store.records.find((record) => record.ref === raw || record.id === raw || slugify(record.title) === slugify(raw));
}

function requireRecord(store, refOrId) {
  const record = findRecord(store, refOrId);
  if (!record) die(`record not found: ${refOrId}`);
  return record;
}

function recordsByType(store, type) {
  return store.records.filter((record) => record.type === type);
}

function parseRefs(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean);
}

function summarizeRecord(record) {
  return {
    ref: record.ref,
    title: record.title,
    type: record.type,
    status: record.status,
    version: record.version,
    updatedAt: record.updatedAt,
  };
}

function showRecord(store, record, flags) {
  const outgoing = store.links.filter((link) => link.fromId === record.id).map((link) => ({
    type: link.type,
    to: store.records.find((candidate) => candidate.id === link.toId)?.ref || link.toId,
  }));
  const incoming = store.links.filter((link) => link.toId === record.id).map((link) => ({
    type: link.type,
    from: store.records.find((candidate) => candidate.id === link.fromId)?.ref || link.fromId,
  }));

  print({ ...record, links: { outgoing, incoming } }, flags);
}

function currentSession(store) {
  if (!store.currentSessionId) return null;
  return store.records.find((record) => record.id === store.currentSessionId) || null;
}

function ensureCurrentSessionLink(store, record) {
  const session = currentSession(store);
  if (session && record.id !== session.id) addLink(store, record.id, session.id, "created_in_session");
}

function copyArtifact(frontierDir, sourcePath, subdir = "raw") {
  const absolute = resolve(sourcePath);
  if (!existsSync(absolute)) die(`file not found: ${sourcePath}`);
  const targetDir = join(frontierDir, subdir);
  mkdirSync(targetDir, { recursive: true });
  const suffix = `${Date.now()}${extname(absolute)}`;
  const targetPath = join(targetDir, `${slugify(basename(absolute, extname(absolute)))}-${suffix}`);
  copyFileSync(absolute, targetPath);
  return targetPath;
}

function help() {
  return `Frontier CLI

Usage:
  ft [global flags] <command> [args]
  ft init <name> [--dry-run]
  ft use <name>
  ft projects [--json|--plain]
  ft status [--json|--plain]
  ft context add <file> --title <title>
  ft context list|show <ref> [--json|--plain]
  ft ingest file <file> --title <title>
  ft ingest text <text>|--stdin --title <title>
  ft ingest list|show <ref> [--json|--plain]
  ft synth create --goal <goal> --context <refs> --ingestion <refs>
  ft actions create --type <type> --title <title> --from-synthesis <ref> --body <file-or-text|->
  ft actions list|show <ref>|search <query> [--json|--plain]
  ft session start <title> [--actor <actor>]
  ft session current|attach <ref>|refs|context [--json|--plain]
  ft wiki list|show <domain>|entrypoints|related <ref> [--json|--plain]
  ft agent docs codex|claude
  ft agent write codex|claude [--path AGENTS.md]
  ft trace <ref> [--json]

Global flags:
  -h, --help       Show help and ignore other args.
  --version        Print the CLI version.
  --json           Print machine-readable JSON.
  --plain          Print stable line-oriented text where supported.
  -q, --quiet      Suppress non-JSON success output.
  -v, --verbose    Reserved for more detailed diagnostics.
  --no-input       Disable prompts. Frontier currently never prompts.
  --no-color       Disable color. Frontier currently emits no color.
  --frontier-dir <path>
                   Use a specific .frontier directory.

Safety:
  --dry-run        Validate write commands without changing files.

Use --json on read commands for agent-readable output.`;
}

function commandHelp(command, subcommand) {
  const key = [command, subcommand].filter(Boolean).join(" ");
  const usages = {
    init: "usage: ft init <name> [--dry-run]",
    use: "usage: ft use <name>",
    projects: "usage: ft projects [--json|--plain]",
    status: "usage: ft status [--json|--plain]",
    "context add": "usage: ft context add <file> [--title <title>] [--tags <refs>] [--dry-run]",
    "context list": "usage: ft context list [--json|--plain]",
    "context show": "usage: ft context show <ref> [--json]",
    "ingestion list": "usage: ft ingest list [--json|--plain]",
    "ingestion show": "usage: ft ingest show <ref> [--json]",
    "ingest file": "usage: ft ingest file <file> [--title <title>] [--tags <refs>] [--observed-at <iso>] [--dry-run]",
    "ingest text": "usage: ft ingest text <text>|--stdin --title <title> [--tags <refs>] [--observed-at <iso>] [--dry-run]",
    "synth create": "usage: ft synth create --goal <goal> [--context <refs>] [--ingestion <refs>] [--summary <text>] [--prompt <text>] [--agent <name>] [--model <name>] [--dry-run]",
    "actions create": "usage: ft actions create --type <type> --title <title> [--from-synthesis <ref>] --body <file-or-text|-> [--status <status>] [--dry-run]",
    "actions list": "usage: ft actions list [--json|--plain]",
    "actions show": "usage: ft actions show <ref> [--json]",
    "actions search": "usage: ft actions search <query> [--json|--plain]",
    "session start": "usage: ft session start <title> [--actor <actor>] [--interface <name>] [--dry-run]",
    "session current": "usage: ft session current [--json|--plain]",
    "session attach": "usage: ft session attach <ref> [--dry-run]",
    "session refs": "usage: ft session refs [--json|--plain]",
    "session context": "usage: ft session context [--json]",
    "wiki list": "usage: ft wiki list [--json|--plain]",
    "wiki show": "usage: ft wiki show <domain> [--json]",
    "wiki map": "usage: ft wiki map <domain> [--json]",
    "wiki entrypoints": "usage: ft wiki entrypoints [--json]",
    "wiki related": "usage: ft wiki related <ref> [--json|--plain]",
    "agent docs": "usage: ft agent docs codex|claude [--json]",
    "agent write": "usage: ft agent write codex|claude [--path AGENTS.md] [--force] [--dry-run]",
    trace: "usage: ft trace <ref> [--json]",
  };
  return usages[key] || usages[command] || help();
}

function validateFlags(flags, allowed = []) {
  const allowedSet = new Set([...GLOBAL_FLAGS, ...allowed]);
  for (const key of Object.keys(flags)) {
    if (!allowedSet.has(key)) die(`unknown flag: --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, 2);
  }
  if (flags.json && flags.plain) die("choose only one output mode: --json or --plain", 2);
}

function withDryRun(data, flags) {
  return flags.dryRun ? { dryRun: true, ...data } : data;
}

function readStdinText() {
  if (stdin.isTTY) die("stdin is empty. Pipe input or pass a value.", 2);
  return readFileSync(0, "utf8");
}

function handleInit(args, flags) {
  validateFlags(flags, ["dryRun"]);
  const name = args[0];
  if (!name) die(commandHelp("init"), 2);
  const dir = join(cwd(), FRONTIER_DIR);
  if (storeExists(dir)) die("Frontier project already exists here.");
  if (flags.dryRun) {
    print({ dryRun: true, project: name, path: dir, wouldCreate: [join(dir, "config.json"), join(dir, STORE_FILE), join(dir, "artifacts"), join(dir, "raw")] }, flags);
    return;
  }
  mkdirSync(join(dir, "artifacts"), { recursive: true });
  mkdirSync(join(dir, "raw"), { recursive: true });
  const store = initialStore(name);
  writeFileSync(join(dir, "config.json"), `${JSON.stringify({ projectId: store.project.id, currentSessionId: null, storage: "sqlite" }, null, 2)}\n`);
  saveSqliteStore(join(dir, STORE_FILE), store);
  print(`Initialized Frontier project "${name}" in ${dir}`, flags);
}

function handleStatus(flags) {
  validateFlags(flags);
  const loaded = loadStore(false);
  if (!loaded) {
    print({ frontier: false, message: "No Frontier project found." }, flags);
    return;
  }
  const session = currentSession(loaded.data);
  print({
    frontier: true,
    project: loaded.data.project.name,
    path: loaded.dir,
    currentSession: session ? summarizeRecord(session) : null,
    records: loaded.data.records.length,
    links: loaded.data.links.length,
    events: loaded.data.events.length,
  }, flags);
}

function handleUse(args, flags) {
  validateFlags(flags);
  const loaded = loadStore();
  const expected = args.join(" ");
  if (expected && slugify(expected) !== slugify(loaded.data.project.name)) {
    die(`current Frontier project is "${loaded.data.project.name}", not "${expected}".`);
  }
  print({
    project: loaded.data.project.name,
    path: loaded.dir,
    message: "Using project-local Frontier workspace.",
  }, flags);
}

function handleProjects(flags) {
  validateFlags(flags);
  const loaded = loadStore(false);
  if (!loaded) {
    print([], flags);
    return;
  }
  print([
    {
      name: loaded.data.project.name,
      id: loaded.data.project.id,
      path: loaded.dir,
      current: true,
    },
  ], flags);
}

function handleTypedRecords(type, subcommand, args, flags) {
  const allowed = {
    list: [],
    show: [],
    add: ["title", "tags", "dryRun"],
    file: ["title", "tags", "observedAt", "dryRun"],
    text: ["title", "tags", "observedAt", "stdin", "dryRun"],
  };
  validateFlags(flags, allowed[subcommand] || []);
  const loaded = loadStore();
  const store = loaded.data;

  if (subcommand === "list") {
    print(recordsByType(store, type).map(summarizeRecord), flags);
    return;
  }

  if (subcommand === "show") {
    if (!args[0]) die(commandHelp(type, "show"), 2);
    showRecord(store, requireRecord(store, args[0]), flags);
    return;
  }

  if (type === "context" && subcommand === "add") {
    const file = args[0];
    if (!file) die(commandHelp("context", "add"), 2);
    const title = flags.title || basename(file, extname(file));
    const body = readFileSync(resolve(file), "utf8");
    const artifactPath = flags.dryRun ? null : copyArtifact(loaded.dir, file, "artifacts");
    const record = createRecord(store, "context", {
      title,
      body,
      metadata: { sourcePath: resolve(file), artifactPath },
      tags: parseRefs(flags.tags),
    });
    ensureCurrentSessionLink(store, record);
    maybeSaveStore(loaded, flags);
    print(withDryRun(summarizeRecord(record), flags), flags);
    return;
  }

  if (type === "ingestion" && subcommand === "file") {
    const file = args[0];
    if (!file) die(commandHelp("ingest", "file"), 2);
    const title = flags.title || basename(file, extname(file));
    const body = readFileSync(resolve(file), "utf8");
    const rawPath = flags.dryRun ? null : copyArtifact(loaded.dir, file, "raw");
    const record = createRecord(store, "ingestion", {
      title,
      body,
      observedAt: flags.observedAt || now(),
      metadata: { sourceType: "file", sourcePath: resolve(file), rawPath },
      tags: parseRefs(flags.tags),
    });
    ensureCurrentSessionLink(store, record);
    maybeSaveStore(loaded, flags);
    print(withDryRun(summarizeRecord(record), flags), flags);
    return;
  }

  if (type === "ingestion" && subcommand === "text") {
    const text = flags.stdin || args[0] === "-" ? readStdinText() : args.join(" ");
    if (!text || !flags.title) die(commandHelp("ingest", "text"), 2);
    const record = createRecord(store, "ingestion", {
      title: flags.title,
      body: text,
      observedAt: flags.observedAt || now(),
      metadata: { sourceType: "text" },
      tags: parseRefs(flags.tags),
    });
    ensureCurrentSessionLink(store, record);
    maybeSaveStore(loaded, flags);
    print(withDryRun(summarizeRecord(record), flags), flags);
    return;
  }

  die(`unknown command: ft ${type === "ingestion" ? "ingest" : type} ${subcommand || ""}`.trim(), 2);
}

function handleSession(subcommand, args, flags) {
  const allowed = {
    start: ["actor", "interface", "title", "dryRun"],
    current: [],
    attach: ["dryRun"],
    refs: [],
    context: [],
  };
  validateFlags(flags, allowed[subcommand] || []);
  const loaded = loadStore();
  const store = loaded.data;

  if (subcommand === "start") {
    const title = args.join(" ") || flags.title || "Untitled Session";
    const record = createRecord(store, "session", {
      title,
      payload: { actor: flags.actor || "human", interface: flags.interface || "cli" },
    });
    store.currentSessionId = record.id;
    addEvent(store, "session.started", { recordId: record.id, actor: record.payload.actor });
    maybeSaveStore(loaded, flags);
    print(withDryRun(summarizeRecord(record), flags), flags);
    return;
  }

  if (subcommand === "current") {
    const session = currentSession(store);
    print(session ? summarizeRecord(session) : { currentSession: null }, flags);
    return;
  }

  if (subcommand === "attach") {
    const session = currentSession(store);
    if (!session) die("no current session. Run `ft session start <title>` first.");
    if (!args[0]) die(commandHelp("session", "attach"), 2);
    const record = requireRecord(store, args[0]);
    addLink(store, session.id, record.id, "attached_record");
    addEvent(store, "session.attached", { sessionId: session.id, recordId: record.id });
    maybeSaveStore(loaded, flags);
    print(withDryRun({ session: session.ref, attached: record.ref }, flags), flags);
    return;
  }

  if (subcommand === "refs") {
    const session = currentSession(store);
    if (!session) die("no current session.");
    const refs = store.links
      .filter((link) => link.fromId === session.id && link.type === "attached_record")
      .map((link) => summarizeRecord(requireRecord(store, link.toId)));
    print(refs, flags);
    return;
  }

  if (subcommand === "context") {
    const session = currentSession(store);
    if (!session) die("no current session.");
    const attached = store.links
      .filter((link) => link.fromId === session.id && link.type === "attached_record")
      .map((link) => summarizeRecord(requireRecord(store, link.toId)));
    const recentEvents = store.events.filter((event) => event.sessionId === session.id).slice(-20);
    print({
      project: store.project.name,
      session: summarizeRecord(session),
      attachedRecords: attached,
      recentSynthesis: recordsByType(store, "synthesis").slice(-5).map(summarizeRecord),
      recentActions: recordsByType(store, "action").slice(-5).map(summarizeRecord),
      recentEvents,
    }, flags);
    return;
  }

  die(`unknown command: ft session ${subcommand || ""}`.trim(), 2);
}

function handleSynth(subcommand, args, flags) {
  validateFlags(flags, ["goal", "context", "ingestion", "summary", "prompt", "agent", "model", "dryRun"]);
  if (subcommand !== "create") die(`unknown command: ft synth ${subcommand || ""}`.trim(), 2);
  const loaded = loadStore();
  const store = loaded.data;
  const goal = flags.goal || args.join(" ");
  if (!goal) die(commandHelp("synth", "create"), 2);

  const contextRecords = parseRefs(flags.context).map((ref) => requireRecord(store, ref));
  const ingestionRecords = parseRefs(flags.ingestion).map((ref) => requireRecord(store, ref));
  const record = createRecord(store, "synthesis", {
    title: goal,
    body: flags.summary || "",
    payload: {
      goal,
      prompt: flags.prompt || "",
      agent: flags.agent || null,
      model: flags.model || null,
    },
  });

  for (const context of contextRecords) addLink(store, record.id, context.id, "used_context", { version: context.version });
  for (const ingestion of ingestionRecords) addLink(store, record.id, ingestion.id, "used_ingestion", { version: ingestion.version });
  ensureCurrentSessionLink(store, record);
  maybeSaveStore(loaded, flags);
  print(withDryRun(summarizeRecord(record), flags), flags);
}

function readBody(input) {
  if (!input) return "";
  if (input === "-") return readStdinText();
  const absolute = resolve(input);
  if (existsSync(absolute)) return readFileSync(absolute, "utf8");
  return input;
}

function handleActions(subcommand, args, flags) {
  const allowed = {
    list: [],
    show: [],
    search: [],
    create: ["title", "type", "fromSynthesis", "body", "status", "dryRun"],
  };
  validateFlags(flags, allowed[subcommand] || []);
  const loaded = loadStore();
  const store = loaded.data;

  if (subcommand === "list") {
    print(recordsByType(store, "action").map(summarizeRecord), flags);
    return;
  }

  if (subcommand === "show") {
    if (!args[0]) die(commandHelp("actions", "show"), 2);
    showRecord(store, requireRecord(store, args[0]), flags);
    return;
  }

  if (subcommand === "search") {
    const query = args.join(" ").toLowerCase();
    const matches = recordsByType(store, "action").filter((record) => {
      return record.title.toLowerCase().includes(query) || record.body.toLowerCase().includes(query);
    });
    print(matches.map(summarizeRecord), flags);
    return;
  }

  if (subcommand === "create") {
    if (!flags.title || !flags.type || !flags.body) die(commandHelp("actions", "create"), 2);
    const synthesis = flags.fromSynthesis ? requireRecord(store, flags.fromSynthesis) : null;
    if (synthesis && synthesis.type !== "synthesis") die("--from-synthesis must reference a synthesis record.");
    const record = createRecord(store, "action", {
      title: flags.title,
      body: readBody(flags.body),
      payload: { actionType: flags.type },
      status: flags.status || "draft",
    });
    if (synthesis) {
      addLink(store, record.id, synthesis.id, "produced_by");
      addLink(store, synthesis.id, record.id, "produced");
    }
    ensureCurrentSessionLink(store, record);
    maybeSaveStore(loaded, flags);
    print(withDryRun(summarizeRecord(record), flags), flags);
    return;
  }

  die(`unknown command: ft actions ${subcommand || ""}`.trim(), 2);
}

function handleTrace(args, flags) {
  validateFlags(flags);
  const loaded = loadStore();
  const store = loaded.data;
  if (!args[0]) die(commandHelp("trace"), 2);
  const record = requireRecord(store, args[0]);
  const incoming = store.links.filter((link) => link.toId === record.id);
  const outgoing = store.links.filter((link) => link.fromId === record.id);

  const producedBy = outgoing.filter((link) => link.type === "produced_by").map((link) => requireRecord(store, link.toId));
  const synthesis = producedBy[0];
  const synthesisInputs = synthesis
    ? store.links
        .filter((link) => link.fromId === synthesis.id && ["used_context", "used_ingestion"].includes(link.type))
        .map((link) => ({ relation: link.type, record: summarizeRecord(requireRecord(store, link.toId)), version: link.metadata.version }))
    : [];

  const sessions = outgoing
    .filter((link) => link.type === "created_in_session")
    .map((link) => summarizeRecord(requireRecord(store, link.toId)));

  print({
    record: summarizeRecord(record),
    producedBy: synthesis ? summarizeRecord(synthesis) : null,
    inputs: synthesisInputs,
    sessions,
    incomingLinks: incoming.map((link) => ({ type: link.type, from: requireRecord(store, link.fromId).ref })),
    outgoingLinks: outgoing.map((link) => ({ type: link.type, to: requireRecord(store, link.toId).ref })),
  }, flags);
}

function handleWiki(subcommand, args, flags) {
  validateFlags(flags);
  const loaded = loadStore();
  const store = loaded.data;
  const domains = ["context", "ingestion", "synthesis", "actions"];

  if (subcommand === "list") {
    print(domains.map((domain) => ({ domain, records: recordsByType(store, domain === "actions" ? "action" : domain).length })), flags);
    return;
  }

  if (subcommand === "show" || subcommand === "map") {
    const domain = args[0];
    const type = domain === "actions" ? "action" : domain;
    if (!domain) die(commandHelp("wiki", subcommand), 2);
    if (!RECORD_TYPES.has(type)) die(`unknown wiki domain: ${domain}`, 2);
    print({
      wiki: domain,
      entrypoints: recordsByType(store, type).slice(0, 5).map(summarizeRecord),
      records: recordsByType(store, type).map(summarizeRecord),
    }, flags);
    return;
  }

  if (subcommand === "entrypoints") {
    print({
      context: recordsByType(store, "context").slice(0, 5).map(summarizeRecord),
      ingestion: recordsByType(store, "ingestion").slice(0, 5).map(summarizeRecord),
      synthesis: recordsByType(store, "synthesis").slice(-5).map(summarizeRecord),
      actions: recordsByType(store, "action").slice(-5).map(summarizeRecord),
    }, flags);
    return;
  }

  if (subcommand === "related") {
    if (!args[0]) die(commandHelp("wiki", "related"), 2);
    const record = requireRecord(store, args[0]);
    const relatedIds = new Set();
    for (const link of store.links) {
      if (link.fromId === record.id) relatedIds.add(link.toId);
      if (link.toId === record.id) relatedIds.add(link.fromId);
    }
    print([...relatedIds].map((id) => summarizeRecord(requireRecord(store, id))), flags);
    return;
  }

  die(`unknown command: ft wiki ${subcommand || ""}`.trim(), 2);
}

function agentDocs(agent) {
  return `# Frontier Agent Instructions

You are operating inside a Frontier project through the \`ft\` CLI.

Frontier is the system of record for this project. It owns records, wikis, sessions, synthesis, actions, timestamps, and provenance. The surrounding chat app is only an interface.

Core model:

\`\`\`text
Context + Ingestion -> Synthesis -> Actions
\`\`\`

Important concepts:

- Context records hold durable goals, strategy, constraints, and baseline knowledge.
- Ingestion records hold imported data such as files, notes, links, transcripts, and observations.
- Synthesis records capture the reasoning/run that combines Context and Ingestion.
- Action records are the useful outputs produced by Synthesis.
- Wikis are human and agent readable maps over the record graph.
- Sessions are the current knowledge/action working state, similar to a cwd or Git branch.

Before doing work:

1. Run \`ft status --json\`.
2. Run \`ft session current --json\`.
3. If no session exists, start one with \`ft session start "<short task title>" --actor ${agent}\`.
4. Inspect current working state with \`ft session context --json\`.
5. Inspect relevant wiki entrypoints with \`ft wiki entrypoints --json\`.
6. Search existing Actions before creating a new Action.

Rules:

- Use \`--json\` for state-reading commands.
- Treat Frontier as the source of truth.
- Read relevant wiki entrypoints before acting.
- Prefer updating or reusing existing Actions when appropriate.
- Create or identify a Synthesis record before creating Actions.
- Link every new Action to its producing Synthesis record.
- Attach important Context and Ingestion records to the current session.
- Run \`ft trace <action-ref> --json\` after creating or updating an Action.
- Summarize created or updated records by their stable \`@\` references.

Useful commands:

\`\`\`bash
ft status --json
ft session current --json
ft session context --json
ft session attach @context/example --json
ft wiki entrypoints --json
ft wiki show context --json
ft wiki related @context/example --json
ft actions search "brief" --json
ft synth create --goal "..." --context @context/... --ingestion @ingestion/... --json
ft actions create --type markdown --title "..." --from-synthesis @synthesis/... --body ./output.md --json
ft trace @action/... --json
\`\`\`
`;
}

function handleAgent(subcommand, args, flags) {
  const allowed = {
    docs: [],
    write: ["path", "force", "dryRun"],
  };
  validateFlags(flags, allowed[subcommand] || []);
  if (!["docs", "write"].includes(subcommand)) die(`unknown command: ft agent ${subcommand || ""}`.trim(), 2);
  const agent = args[0] || "agent";
  const docs = agentDocs(agent);

  if (subcommand === "write") {
    const targetPath = resolve(flags.path || "AGENTS.md");
    if (existsSync(targetPath) && !flags.force) {
      die(`${targetPath} already exists. Pass --force to overwrite.`);
    }
    if (flags.dryRun) {
      print({ dryRun: true, path: targetPath, agent, written: false }, flags);
      return;
    }
    writeFileSync(targetPath, docs);
    print({ path: targetPath, agent, written: true }, flags);
    return;
  }

  print(flags.json ? { agent, docs } : docs, flags);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, subcommand, ...args] = positional;
  if (flags.frontierDir) process.env.FRONTIER_DIR = flags.frontierDir;

  if (flags.version || command === "--version") {
    console.log(CLI_VERSION);
    return;
  }

  if (!command || flags.help || flags.h || command === "--help" || command === "help") {
    print(help(), flags);
    return;
  }

  if (command === "init") return handleInit([subcommand, ...args].filter(Boolean), flags);
  if (command === "use") return handleUse([subcommand, ...args].filter(Boolean), flags);
  if (command === "projects") return handleProjects(flags);
  if (command === "status") return handleStatus(flags);
  if (command === "context") return handleTypedRecords("context", subcommand, args, flags);
  if (command === "ingest") return handleTypedRecords("ingestion", subcommand, args, flags);
  if (command === "session") return handleSession(subcommand, args, flags);
  if (command === "synth") return handleSynth(subcommand, args, flags);
  if (command === "actions") return handleActions(subcommand, args, flags);
  if (command === "trace") return handleTrace([subcommand, ...args].filter(Boolean), flags);
  if (command === "wiki") return handleWiki(subcommand, args, flags);
  if (command === "agent") return handleAgent(subcommand, args, flags);

  die(`unknown command: ft ${command}`, 2);
}

main();
