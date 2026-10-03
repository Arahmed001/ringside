import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * The committed home of the Arabic spellings of proper names (`i18n/names.ar.json`).
 *
 * Names are used at run time from the `name_translations` table, but that table lives in the local database, which is not
 * committed and is rebuilt from scratch on a fresh checkout. So the file is the source of truth and the table is a copy of
 * it: the database loads the file when it opens, and the names commands and the review import write back to it.
 *
 * Loading never loses a person's work. If a name was reviewed in the database and the file's copy was not, the database copy
 * stands (and is written back to the file the next time names are saved).
 */
export interface NameEntry { ar: string; source: string; reviewed: boolean }
export type NamesFile = Record<string, NameEntry>;

export const namesFilePath = () => path.join(process.env.I18N_DIR ?? path.join(process.cwd(), "i18n"), "names.ar.json");

const HAS_ARABIC = /[؀-ۿ]/;

export function readNamesFile(file = namesFilePath()): NamesFile {
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Partial<NameEntry>>;
  const out: NamesFile = {};
  for (const [en, e] of Object.entries(raw)) if (e && typeof e.ar === "string" && e.ar.trim() && HAS_ARABIC.test(e.ar)) out[en] = { ar: e.ar.trim(), source: typeof e.source === "string" && e.source ? e.source : "claude-session", reviewed: e.reviewed === true };
  return out;
}

/** Sorted by English spelling, one name per line, so a diff shows exactly the names that changed. */
export function writeNamesFile(names: NamesFile, file = namesFilePath()): void {
  const lines = Object.keys(names).sort().map((k) => `${JSON.stringify(k)}: ${JSON.stringify({ ar: names[k].ar, source: names[k].source, reviewed: names[k].reviewed })}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `{\n${lines.map((l) => ` ${l}`).join(",\n")}\n}\n`);
}

const ensureTable = (db: DatabaseSync) => db.exec("CREATE TABLE IF NOT EXISTS name_translations (en TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'claude', reviewed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (en, locale))");

export function readDbNames(db: DatabaseSync): NamesFile {
  ensureTable(db);
  const out: NamesFile = {};
  for (const r of db.prepare("SELECT en, text, source, reviewed FROM name_translations WHERE locale = 'ar'").all() as { en: string; text: string; source: string; reviewed: number }[]) out[r.en] = { ar: r.text, source: r.source, reviewed: !!r.reviewed };
  return out;
}

export interface SyncResult { inserted: number; updated: number; kept: number }

/** File into database. A name the database has and the file disagrees on: the file wins, unless a person reviewed the database copy and not the file's. */
export function syncNamesFromFile(db: DatabaseSync, file = namesFilePath()): SyncResult {
  const names = readNamesFile(file);
  const keys = Object.keys(names);
  const res: SyncResult = { inserted: 0, updated: 0, kept: 0 };
  if (!keys.length) return res;
  ensureTable(db);
  const get = db.prepare("SELECT text, source, reviewed FROM name_translations WHERE en = ? AND locale = 'ar'");
  const put = db.prepare("INSERT INTO name_translations (en, locale, text, source, reviewed) VALUES (?, 'ar', ?, ?, ?) ON CONFLICT(en, locale) DO UPDATE SET text = excluded.text, source = excluded.source, reviewed = excluded.reviewed");
  const mark = db.prepare("UPDATE name_translations SET reviewed = 1 WHERE en = ? AND locale = 'ar'");
  db.exec("BEGIN");
  try {
    for (const en of keys) {
      const e = names[en];
      const row = get.get(en) as { text: string; source: string; reviewed: number } | undefined;
      if (!row) { put.run(en, e.ar, e.source, e.reviewed ? 1 : 0); res.inserted++; continue; }
      if (row.text === e.ar) { if (e.reviewed && !row.reviewed) { mark.run(en); res.updated++; } continue; }
      if (row.reviewed && !e.reviewed) { res.kept++; continue; }
      put.run(en, e.ar, e.source, e.reviewed ? 1 : 0); res.updated++;
    }
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
  return res;
}

/** Database into file, after loading the file first so a database that is missing names can never shrink it. Returns how many names the file holds. */
export function saveNamesToFile(db: DatabaseSync, file = namesFilePath()): number {
  syncNamesFromFile(db, file);
  const names = readDbNames(db);
  writeNamesFile(names, file);
  return Object.keys(names).length;
}

/** Every distinct proper name the site can show, with what kind of thing it is (the kind steers a translator). */
export function collectNames(db: DatabaseSync): Map<string, string> {
  const out = new Map<string, string>();
  const add = (s: unknown, kind: string) => { if (typeof s === "string" && s.trim() && !out.has(s)) out.set(s, kind); };
  const col = (sql: string, kind: string) => { for (const r of db.prepare(sql).all() as Record<string, unknown>[]) add(Object.values(r)[0], kind); };
  col("SELECT name FROM boxers", "person name");
  col("SELECT name FROM people", "person name");
  col("SELECT nickname FROM boxers WHERE nickname IS NOT NULL", "boxer nickname (translate the meaning)");
  for (const r of db.prepare("SELECT aliases FROM boxers WHERE aliases IS NOT NULL").all() as { aliases: string }[]) for (const a of JSON.parse(r.aliases) as string[]) add(a, "person name");
  col("SELECT name FROM orgs", "boxing organisation, gym or promotion name");
  col("SELECT city FROM orgs WHERE city IS NOT NULL", "city");
  col("SELECT name FROM events", "boxing event name");
  col("SELECT venue FROM events", "venue or arena name");
  col("SELECT city FROM events", "city");
  col("SELECT birth_place FROM boxers WHERE birth_place IS NOT NULL", "place of birth, 'city, country'");
  col("SELECT residence FROM boxers WHERE residence IS NOT NULL", "place of residence, 'city, country'");
  col("SELECT DISTINCT title FROM bouts WHERE title IS NOT NULL", "championship title name");
  col("SELECT DISTINCT broadcaster FROM events WHERE broadcaster IS NOT NULL", "TV broadcaster or streaming service");
  col("SELECT DISTINCT broadcaster FROM event_broadcasts", "TV broadcaster or streaming service");
  col("SELECT DISTINCT region FROM event_broadcasts WHERE region != '' AND region NOT IN (SELECT country FROM events)", "broadcast region or territory");
  return out;
}
