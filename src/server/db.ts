import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * SQLite access layer.
 *
 * We use Node's built-in `node:sqlite` (stable in Node 24) rather than
 * better-sqlite3, so the whole app has zero native build steps. `DatabaseSync` is
 * synchronous, which is fine here: every statement is a point lookup or a
 * single-row write on a local file, and the HTTP layer is dominated by upstream
 * latency.
 *
 * FTS5 backs memory recall — BM25 ranking runs locally, in-process, for free.
 */

export const SCHEMA_VERSION = 1;

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS stories (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  genre           TEXT NOT NULL DEFAULT '',
  scenario        TEXT NOT NULL DEFAULT '',
  bible           TEXT NOT NULL DEFAULT '',
  style           TEXT NOT NULL DEFAULT '',
  exemplars       TEXT NOT NULL DEFAULT '',
  instruct        TEXT NOT NULL DEFAULT '',
  persona_id      TEXT,
  /*
   * Set on a 1:1 character chat: the one card that chat is about, borrowed from
   * the story that owns it. A real foreign key on purpose — deleting the card
   * deletes the chat and everything in it, declared once here instead of
   * re-derived in every route. This is a forward reference to the characters
   * table, created later in this same script; SQLite resolves it at DML time,
   * not at CREATE TABLE time, so the order is safe.
   */
  character_id    TEXT REFERENCES characters(id) ON DELETE CASCADE,
  model           TEXT NOT NULL DEFAULT 'deepseek-flash',
  effort          TEXT NOT NULL DEFAULT 'none',
  temperature     REAL NOT NULL DEFAULT 1.0,
  top_p           REAL NOT NULL DEFAULT 0.98,
  max_tokens      INTEGER NOT NULL DEFAULT 900,
  target_words    INTEGER NOT NULL DEFAULT 300,
  contract        TEXT NOT NULL DEFAULT '',
  lore_budget     INTEGER NOT NULL DEFAULT 2000,
  history_budget  INTEGER NOT NULL DEFAULT 32000,
  prefill         TEXT NOT NULL DEFAULT '',
  theme           TEXT NOT NULL DEFAULT 'ink',
  cover           TEXT,
  synopsis        TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id          TEXT PRIMARY KEY,
  story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT '[]',
  notes       TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scenes_story ON scenes(story_id, archived, sort_order);

CREATE TABLE IF NOT EXISTS characters (
  id               TEXT PRIMARY KEY,
  story_id         TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  tagline          TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  personality      TEXT NOT NULL DEFAULT '',
  speech           TEXT NOT NULL DEFAULT '',
  scenario         TEXT NOT NULL DEFAULT '',
  example_dialogue TEXT NOT NULL DEFAULT '',
  meta             TEXT NOT NULL DEFAULT '{}',
  avatar           TEXT,
  tokens           INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS characters_story ON characters(story_id, sort_order);

CREATE TABLE IF NOT EXISTS personas (
  id          TEXT PRIMARY KEY,
  story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar      TEXT,
  tokens      INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS personas_story ON personas(story_id);

CREATE TABLE IF NOT EXISTS lore (
  id         TEXT PRIMARY KEY,
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  keys       TEXT NOT NULL DEFAULT '',
  position   TEXT NOT NULL DEFAULT 'anchor',
  depth      INTEGER NOT NULL DEFAULT 4,
  priority   INTEGER NOT NULL DEFAULT 100,
  weight     REAL NOT NULL DEFAULT 1.0,
  constant   INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  tokens     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lore_story ON lore(story_id, enabled, position, priority);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  story_id      TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  scene_id      TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  variants      TEXT NOT NULL DEFAULT '[]',
  active_variant INTEGER NOT NULL DEFAULT 0,
  reasoning     TEXT NOT NULL DEFAULT '[]',
  origin        TEXT NOT NULL DEFAULT 'user',
  speaker       TEXT,
  injections    TEXT NOT NULL DEFAULT '[]',
  usage         TEXT,
  pinned        INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  seq           INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_story ON messages(story_id, seq);
CREATE INDEX IF NOT EXISTS messages_scene ON messages(scene_id, seq);

CREATE TABLE IF NOT EXISTS memories (
  id                TEXT PRIMARY KEY,
  story_id          TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  text              TEXT NOT NULL,
  subject           TEXT NOT NULL DEFAULT '',
  source_message_id TEXT,
  seq               INTEGER NOT NULL DEFAULT 0,
  salience          REAL NOT NULL DEFAULT 0.5,
  kind              TEXT NOT NULL DEFAULT 'fact',
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_story ON memories(story_id, seq);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  text,
  subject,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  message_id TEXT,
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL,
  payload    TEXT,
  accepted   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_story ON notes(story_id, created_at);

CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  scene_id    TEXT,
  label       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  opened_at   TEXT,
  resolved_at TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_story ON threads(story_id, status);

CREATE TABLE IF NOT EXISTS cost_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id         TEXT,
  kind             TEXT NOT NULL,
  model            TEXT NOT NULL,
  cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,
  saved_usd        REAL NOT NULL DEFAULT 0,
  peak             INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cost_events_story ON cost_events(story_id, created_at);
CREATE INDEX IF NOT EXISTS cost_events_time ON cost_events(created_at);

CREATE TABLE IF NOT EXISTS prefixes (
  fingerprint   TEXT PRIMARY KEY,
  story_id      TEXT NOT NULL,
  tokens        INTEGER NOT NULL DEFAULT 0,
  block_hashes  TEXT NOT NULL DEFAULT '{}',
  block_tokens  TEXT NOT NULL DEFAULT '{}',
  message_hashes TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS prefixes_story ON prefixes(story_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

/*
 * Reusable prompt text. The blocks column is a JSON map of editable block name to
 * text — a template usually fills one block but may fill several. It is
 * app-scoped rather than story-scoped precisely so the same preset can be applied
 * anywhere, which is also why applying it copies the text instead of pointing at
 * the row.
 *
 * A new table needs no migration entry: the DDL below runs against an existing
 * file on every boot, and simply creates what is missing.
 */
CREATE TABLE IF NOT EXISTS prompt_templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  blurb      TEXT NOT NULL DEFAULT '',
  blocks     TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS warmups (
  story_id     TEXT PRIMARY KEY,
  fingerprint  TEXT NOT NULL,
  warmed_at    INTEGER NOT NULL,
  tokens       INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL NOT NULL DEFAULT 0
);
`;

let db: DatabaseSync | null = null;

/**
 * Additive migrations.
 *
 * `CREATE TABLE IF NOT EXISTS` silently does nothing for a table that already
 * exists, so a column added to the DDL *after* a database has been created would
 * never appear — the app would then fail at runtime on a stale file. Every
 * column added after v1 must therefore also be listed here. Additive only: no
 * destructive changes, so an existing story database always survives an upgrade.
 */
const ADDITIVE_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'prefixes', column: 'message_hashes', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'personas', column: 'avatar', ddl: 'TEXT' },
  {
    table: 'stories',
    column: 'character_id',
    ddl: 'TEXT REFERENCES characters(id) ON DELETE CASCADE',
  },
];

/**
 * Indexes on columns that migrations may have just added.
 *
 * These cannot live in `DDL`: the script runs *before* `migrate`, so on an
 * existing database the column would not exist yet and `CREATE INDEX` would
 * throw before the migration that adds it ever ran. Running it here is
 * unconditional, so a fresh file and an upgraded one end up identical.
 */
const POST_MIGRATION_INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS stories_character_id
  ON stories(character_id) WHERE character_id IS NOT NULL;
`;

function migrate(handle: DatabaseSync): void {
  for (const migration of ADDITIVE_MIGRATIONS) {
    const columns = handle
      .prepare(`PRAGMA table_info(${migration.table})`)
      .all() as { name: string }[];
    // An empty result means the table does not exist yet and the DDL just created
    // it with the column already present.
    if (columns.length === 0) continue;
    if (columns.some((column) => column.name === migration.column)) continue;
    handle.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.ddl}`);
    console.log(`[reepi] migrated ${migration.table}.${migration.column}`);
  }
  handle.exec(POST_MIGRATION_INDEXES);
}

export function openDatabase(path: string): DatabaseSync {
  if (db) return db;
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const handle = new DatabaseSync(path);
  handle.exec(DDL);
  migrate(handle);
  db = handle;
  return handle;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not opened. Call openDatabase() during boot.');
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}

/**
 * Run `work` in a single transaction.
 *
 * Multi-row writes are not atomic on their own: a story copy touches ten tables,
 * and a failure halfway through would leave a half-built story behind — a corrupt
 * row set that no later request can repair, because nothing knows what it was
 * meant to be. Wrapping the write makes the operation all-or-nothing.
 *
 * `IMMEDIATE` takes the write lock up front rather than on first statement, so a
 * concurrent writer cannot interleave between the reads and the writes.
 *
 * Not re-entrant: `node:sqlite` has no nested transactions, so a nested call would
 * emit a second `BEGIN` and throw. Keep wrapped blocks flat.
 */
export function transaction<T>(work: () => T): T {
  const handle = getDb();
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    // A rollback can itself fail if the connection is already broken; the original
    // error is the one worth propagating.
    try {
      handle.exec('ROLLBACK');
    } catch {
      /* connection already unusable */
    }
    throw error;
  }
}

/* ------------------------------------------------------------ row plumbing */


/**
 * `node:sqlite` returns rows with a null prototype and only knows how to bind
 * null/number/bigint/string/Uint8Array. Normalise at the boundary so the DAOs can
 * stay declarative.
 */
function normaliseRow<T>(row: Record<string, unknown>): T {
  return { ...row } as T;
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

export function intToBool(value: unknown): boolean {
  return value === 1 || value === true;
}

/** JSON columns are stored as text; never let a bad blob take down a request. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}
