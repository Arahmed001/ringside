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
CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, kind TEXT NOT NULL DEFAULT 'team_stint',
  boxer_ext TEXT NOT NULL, role TEXT NOT NULL, person_name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
  source_url TEXT NOT NULL, quote TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  created_at TEXT NOT NULL, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, reviewed_at TEXT, review_note TEXT,
  source_check TEXT, source_checked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contrib_status ON contributions(status);
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
