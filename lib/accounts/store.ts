import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * People's accounts live in their OWN SQLite file, not in ringside.db: the sports database is rebuilt, re-ingested and (for the demo)
 * deleted at will, and nobody's account or picks may go with it. Everything here is keyed by stable external ids (a bout's and a
 * boxer's `external_id`), never by the sports database's row numbers, so a rebuilt database does not orphan a pick.
 * Default location: next to DATABASE_PATH (so the same persistent volume), overridable with ACCOUNTS_DB_PATH.
 */
export const accountsPath = () => process.env.ACCOUNTS_DB_PATH ?? path.join(path.dirname(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db")), "accounts.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','editor','admin')),
  created_at TEXT NOT NULL, last_login TEXT, disabled INTEGER NOT NULL DEFAULT 0, picks_public INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS resets (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS picks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, bout_ext TEXT NOT NULL, boxer_ext TEXT NOT NULL, picked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, bout_ext)
);
CREATE TABLE IF NOT EXISTS watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, boxer_ext TEXT NOT NULL, added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, boxer_ext)
);
CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, kind TEXT NOT NULL DEFAULT 'team_stint',
  boxer_ext TEXT NOT NULL, role TEXT NOT NULL, person_name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
  source_url TEXT NOT NULL, quote TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  created_at TEXT NOT NULL, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT, review_note TEXT,
  source_check TEXT, source_checked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contrib_status ON contributions(status);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('error','about_me')),
  target_type TEXT NOT NULL CHECK (target_type IN ('boxer','bout')), target_ext TEXT NOT NULL,
  field TEXT, shown_value TEXT, proposed_value TEXT,
  source_url TEXT, quote TEXT, note TEXT, contact TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','withdrawn','noted')),
  created_at TEXT NOT NULL, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT, review_note TEXT,
  source_check TEXT, source_checked_at TEXT, by_owner INTEGER NOT NULL DEFAULT 0,
  state TEXT CHECK (state IN ('active','vendor_changed','retired')), original_value TEXT, vendor_value TEXT, applied_at TEXT
);
CREATE TABLE IF NOT EXISTS boxer_owners (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, boxer_ext TEXT NOT NULL,
  verified_by TEXT NOT NULL, verified_at TEXT NOT NULL, note TEXT, official_urls TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, boxer_ext)
);
CREATE INDEX IF NOT EXISTS idx_owners_boxer ON boxer_owners(boxer_ext);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, kind);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_ext);
CREATE TABLE IF NOT EXISTS forum_threads (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('boxer','bout','general')), subject_ext TEXT, title TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, last_post_at TEXT NOT NULL, post_count INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_subject ON forum_threads(kind, subject_ext) WHERE kind <> 'general';
CREATE INDEX IF NOT EXISTS idx_forum_threads_recent ON forum_threads(kind, hidden, last_post_at);
-- the thread under a fighter or a fight is found by (kind, subject): the partial unique index above cannot serve a lookup whose kind is a parameter, so without this one every page view scans every thread of that kind
CREATE INDEX IF NOT EXISTS idx_forum_subject ON forum_threads(kind, subject_ext);
CREATE TABLE IF NOT EXISTS forum_posts (
  id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL, fingerprint TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, edited_at TEXT,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')),
  hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL, hidden_at TEXT, hidden_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_user ON forum_posts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_posts_fp ON forum_posts(fingerprint, created_at);
CREATE TABLE IF NOT EXISTS forum_reports (
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam','abuse','off_topic','other')), note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')), created_at TEXT NOT NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_report_once ON forum_reports(post_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_reports_open ON forum_reports(status, post_id);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, target TEXT, detail TEXT
);
`;

const g = globalThis as unknown as { __accountsDb?: { file: string; db: DatabaseSync } };

/** Opens (creating on first use) the accounts database. Re-opens when the path changes (tests point it at a temp file). */
export function accountsDb(): DatabaseSync {
  const file = accountsPath();
  if (g.__accountsDb?.file === file) return g.__accountsDb.db;
  g.__accountsDb?.db.close();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
  // forward-only migration for accounts files created before sessions carried a device label
  const cols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("label")) db.exec("ALTER TABLE sessions ADD COLUMN label TEXT");
  if (!cols.includes("last_seen")) db.exec("ALTER TABLE sessions ADD COLUMN last_seen TEXT");
  // the date of the latest graded fight a person has been shown in their pick'em recap
  const ucols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!ucols.includes("picks_seen_through")) db.exec("ALTER TABLE users ADD COLUMN picks_seen_through TEXT");
  try { fs.chmodSync(file, 0o600); } catch { /* not supported on every filesystem */ }
  g.__accountsDb = { file, db };
  return db;
}

/** Opens the file only if it already exists, so reading code never creates an accounts database as a side effect. */
export const accountsDbIfAny = (): DatabaseSync | null => (fs.existsSync(accountsPath()) ? accountsDb() : null);
export const closeAccountsDb = () => { g.__accountsDb?.db.close(); g.__accountsDb = undefined; };

export const nowIso = () => new Date().toISOString();

export function audit(db: DatabaseSync, actor: string | null, action: string, target?: string, detail?: string) {
  db.prepare("INSERT INTO audit (at, actor, action, target, detail) VALUES (?,?,?,?,?)").run(nowIso(), actor, action, target ?? null, detail ?? null);
}

/** A username as a whole word, whatever its case: usernames are letters, digits and underscores, so those are what count as part of a word ("ned" is not in "planned"). */
export const nameWord = (name: string) => new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "gi");

/**
 * The activity-log rows that mention a username. The LIKE only finds candidates (usernames are letters, digits and underscores, and an underscore in LIKE
 * matches any letter: a few extra candidates, never a missed one); the whole-word test decides.
 */
export function auditMentioning(db: DatabaseSync, name: string): { id: number; at: string; actor: string | null; action: string; target: string | null; detail: string | null }[] {
  const like = `%${name}%`;
  const word = nameWord(name);
  const rows = db.prepare("SELECT id, at, actor, action, target, detail FROM audit WHERE actor LIKE ? OR target LIKE ? OR detail LIKE ? ORDER BY id").all(like, like, like) as { id: number; at: string; actor: string | null; action: string; target: string | null; detail: string | null }[];
  return rows.filter((r) => [r.actor, r.target, r.detail].some((x) => x !== null && (word.lastIndex = 0, word.test(x))));
}
