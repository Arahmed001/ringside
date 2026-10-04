import { syncNamesFromFile } from "./i18n/names-file";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { ingest, recomputeRatings } from "./ingest";
import { applyContributions } from "./accounts/contributions";
import { applyCorrections } from "./accounts/corrections";
import { REIGN_SCHEMA } from "./importers/wikipedia-champions";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS boxers (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE, slug TEXT UNIQUE, name TEXT, nickname TEXT,
  country TEXT, birth_year INTEGER, stance TEXT, height_cm INTEGER, reach_cm INTEGER,
  weight_class TEXT, turned_pro INTEGER, active INTEGER, rating REAL DEFAULT 1500, photo_url TEXT, photo_credit TEXT,
  birth_date TEXT, birth_place TEXT, residence TEXT, wikidata_id TEXT, boxrec_id TEXT, aliases TEXT, debut_date TEXT, retired_date TEXT,
  sex TEXT DEFAULT 'male'
);
CREATE TABLE IF NOT EXISTS boxer_media (
  boxer_id INTEGER PRIMARY KEY REFERENCES boxers(id), status TEXT, reason TEXT, wikidata_id TEXT, file_title TEXT,
  thumb_url TEXT, page_url TEXT, license TEXT, license_url TEXT, credit TEXT, checked_at TEXT
);
-- Pictures of things that are not fighters (an organisation's logo, a sanctioning body's belt, a venue), each with its licence and author. kind is
-- 'org_logo' (ref: the org's id), 'belt' (ref: WBA, WBC, IBF, WBO) or 'venue' (ref: name|city). Only 'matched' rows are shown.
CREATE TABLE IF NOT EXISTS entity_media (
  kind TEXT NOT NULL, ref TEXT NOT NULL, status TEXT, reason TEXT, wikidata_id TEXT, file_title TEXT,
  thumb_url TEXT, page_url TEXT, license TEXT, license_url TEXT, credit TEXT, checked_at TEXT, PRIMARY KEY (kind, ref)
);
-- The sanctioning bodies' official lists, one whole snapshot at a time (replaced on every ingest that carries one). kind: 'champion' or 'contender'. boxer_id is null for a
-- fighter we do not hold (the name the supplier gave is kept); a vacant belt or place has neither. updated_at is the body's own date, as the supplier reports it.
CREATE TABLE IF NOT EXISTS official_rankings (
  body TEXT NOT NULL, division TEXT NOT NULL, sex TEXT NOT NULL, kind TEXT NOT NULL, rank INTEGER, boxer_id INTEGER, name TEXT, title_type TEXT, vacant INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT, position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_official_rankings_division ON official_rankings (division, sex, body);
CREATE INDEX IF NOT EXISTS idx_official_rankings_boxer ON official_rankings (boxer_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE, name TEXT, date TEXT, venue TEXT, city TEXT, country TEXT, poster_url TEXT,
  promoter_org_id INTEGER, broadcaster TEXT, attendance INTEGER, status TEXT
);
CREATE TABLE IF NOT EXISTS bouts (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE, event_id INTEGER REFERENCES events(id),
  red_id INTEGER REFERENCES boxers(id), blue_id INTEGER REFERENCES boxers(id),
  weight_class TEXT, rounds INTEGER, winner_id INTEGER, method TEXT, end_round INTEGER,
  title TEXT, position INTEGER,
  round_time TEXT, kd_red INTEGER, kd_blue INTEGER, odds_red REAL, odds_blue REAL, contract_lb REAL, title_org_id INTEGER, title_vacant INTEGER, status TEXT
);
CREATE TABLE IF NOT EXISTS rating_history (
  boxer_id INTEGER, bout_id INTEGER, date TEXT, rating REAL, opp_rating REAL
);
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE, slug TEXT UNIQUE, name TEXT, country TEXT, wikidata_id TEXT
);
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE, slug TEXT UNIQUE, name TEXT, kind TEXT, country TEXT, city TEXT
);
CREATE TABLE IF NOT EXISTS team_stints (
  id INTEGER PRIMARY KEY, boxer_id INTEGER REFERENCES boxers(id), role TEXT, person_id INTEGER, org_id INTEGER,
  start_date TEXT, end_date TEXT, source TEXT
);
CREATE TABLE IF NOT EXISTS weigh_ins (
  bout_id INTEGER, boxer_id INTEGER, official_lb REAL, fight_night_lb REAL, limit_lb REAL, made_weight INTEGER, source TEXT,
  PRIMARY KEY (bout_id, boxer_id)
);
CREATE TABLE IF NOT EXISTS officials (
  bout_id INTEGER, role TEXT, person_id INTEGER, seat INTEGER
);
CREATE TABLE IF NOT EXISTS scorecards (
  bout_id INTEGER, judge_id INTEGER, seat INTEGER, red_score INTEGER, blue_score INTEGER
);
CREATE TABLE IF NOT EXISTS corners (
  bout_id INTEGER, boxer_id INTEGER, role TEXT, person_id INTEGER
);
CREATE TABLE IF NOT EXISTS punch_stats (
  bout_id INTEGER, boxer_id INTEGER, round INTEGER, thrown INTEGER, landed INTEGER, power_thrown INTEGER, power_landed INTEGER,
  jab_thrown INTEGER, jab_landed INTEGER, PRIMARY KEY (bout_id, boxer_id, round)
);
CREATE TABLE IF NOT EXISTS wikidata_boxers (
  qid TEXT PRIMARY KEY, name TEXT, birth_date TEXT, birth_year INTEGER, birth_place TEXT, country TEXT, height_cm INTEGER, weight_kg REAL,
  image_file TEXT, boxrec_id TEXT, residence TEXT, death_date TEXT, teachers TEXT, matched_boxer_id INTEGER, match_method TEXT, fetched_at TEXT,
  ibhof_id TEXT, olympedia_id TEXT, awards TEXT, extras_at TEXT, ar_label TEXT, nickname TEXT, enwiki TEXT, labels_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wd_boxrec ON wikidata_boxers(boxrec_id);
CREATE INDEX IF NOT EXISTS idx_wd_year ON wikidata_boxers(birth_year);
CREATE TABLE IF NOT EXISTS honours (
  boxer_id INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, year INTEGER, source TEXT NOT NULL, source_ref TEXT,
  PRIMARY KEY (boxer_id, kind, label, year, source)
);
CREATE INDEX IF NOT EXISTS idx_honours_boxer ON honours(boxer_id);
CREATE TABLE IF NOT EXISTS venues (
  name TEXT NOT NULL, city TEXT NOT NULL, country TEXT, status TEXT NOT NULL, reason TEXT, wikidata_id TEXT, label TEXT,
  lat REAL, lon REAL, capacity INTEGER, basis TEXT, checked_at TEXT, PRIMARY KEY (name, city)
);
CREATE TABLE IF NOT EXISTS prediction_snapshots (
  bout_id INTEGER NOT NULL, locked_on TEXT NOT NULL, locked_at TEXT NOT NULL, model TEXT NOT NULL,
  p_red REAL NOT NULL, p_draw REAL NOT NULL, ko_prob REAL NOT NULL, elo_p_red REAL NOT NULL, inputs TEXT NOT NULL,
  PRIMARY KEY (bout_id, locked_on)
);
CREATE TABLE IF NOT EXISTS event_financials (
  event_id INTEGER NOT NULL, gate_usd REAL, tickets_sold INTEGER, capacity INTEGER, site_fee_usd REAL, ppv_buys INTEGER, ppv_price_usd REAL,
  ppv_revenue_usd REAL, sponsorship_usd REAL, basis TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT, retrieved_at TEXT, note TEXT,
  PRIMARY KEY (event_id, source)
);
CREATE TABLE IF NOT EXISTS purses (
  bout_id INTEGER NOT NULL, boxer_id INTEGER NOT NULL, guaranteed_usd REAL, bonus_usd REAL, total_usd REAL, basis TEXT NOT NULL, source TEXT NOT NULL,
  source_url TEXT, retrieved_at TEXT, note TEXT, PRIMARY KEY (bout_id, boxer_id, source)
);
CREATE INDEX IF NOT EXISTS idx_purses_boxer ON purses(boxer_id);
CREATE TABLE IF NOT EXISTS event_broadcasts (
  event_id INTEGER NOT NULL, broadcaster TEXT NOT NULL, platform TEXT NOT NULL, region TEXT NOT NULL DEFAULT '', viewers_avg INTEGER, viewers_peak INTEGER,
  basis TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT, retrieved_at TEXT, note TEXT, PRIMARY KEY (event_id, broadcaster, region, source)
);
CREATE TABLE IF NOT EXISTS earnings (
  boxer_id INTEGER NOT NULL, year INTEGER NOT NULL, total_usd REAL NOT NULL, ring_usd REAL, off_ring_usd REAL, basis TEXT NOT NULL, source TEXT NOT NULL,
  source_url TEXT, retrieved_at TEXT, note TEXT, PRIMARY KEY (boxer_id, year, source)
);
CREATE TABLE IF NOT EXISTS name_translations (
  en TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'claude', reviewed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (en, locale)
);
CREATE TABLE IF NOT EXISTS ingest_runs (
  id INTEGER PRIMARY KEY, at TEXT, provider TEXT, errors INTEGER, warnings INTEGER, infos INTEGER, counts TEXT, dropped TEXT
);
CREATE TABLE IF NOT EXISTS ingest_issues (
  run_id INTEGER, severity TEXT, code TEXT, entity TEXT, ref TEXT, message TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_run ON ingest_issues(run_id);
CREATE INDEX IF NOT EXISTS idx_stints_boxer ON team_stints(boxer_id);
CREATE INDEX IF NOT EXISTS idx_stints_person ON team_stints(person_id);
CREATE INDEX IF NOT EXISTS idx_stints_org ON team_stints(org_id);
CREATE INDEX IF NOT EXISTS idx_weigh_boxer ON weigh_ins(boxer_id);
CREATE INDEX IF NOT EXISTS idx_officials_bout ON officials(bout_id);
CREATE INDEX IF NOT EXISTS idx_score_bout ON scorecards(bout_id);
CREATE INDEX IF NOT EXISTS idx_corners_bout ON corners(bout_id);
CREATE INDEX IF NOT EXISTS idx_bouts_red ON bouts(red_id);
CREATE INDEX IF NOT EXISTS idx_bouts_blue ON bouts(blue_id);
CREATE INDEX IF NOT EXISTS idx_bouts_event ON bouts(event_id);
CREATE INDEX IF NOT EXISTS idx_rh_boxer ON rating_history(boxer_id, date);
${REIGN_SCHEMA}
`;

/** Columns added after the first release; lets an older ringside.db keep working. */
const ADDED_COLUMNS: [string, string, string][] = [
  ["boxers", "birth_date", "TEXT"], ["boxers", "birth_place", "TEXT"], ["boxers", "residence", "TEXT"], ["boxers", "wikidata_id", "TEXT"],
  ["boxers", "boxrec_id", "TEXT"], ["boxers", "ibhof_id", "TEXT"], ["boxers", "olympedia_id", "TEXT"], ["boxers", "aliases", "TEXT"], ["boxers", "debut_date", "TEXT"], ["boxers", "retired_date", "TEXT"],
  ["orgs", "wikidata_id", "TEXT"], ["boxers", "vendor_wins", "INTEGER"], ["boxers", "vendor_losses", "INTEGER"], ["boxers", "vendor_draws", "INTEGER"], ["events", "promoter_org_id", "INTEGER"], ["events", "broadcaster", "TEXT"], ["events", "attendance", "INTEGER"],
  ["wikidata_boxers", "ibhof_id", "TEXT"], ["wikidata_boxers", "olympedia_id", "TEXT"], ["wikidata_boxers", "awards", "TEXT"], ["wikidata_boxers", "extras_at", "TEXT"], ["wikidata_boxers", "ar_label", "TEXT"], ["wikidata_boxers", "nickname", "TEXT"], ["wikidata_boxers", "enwiki", "TEXT"], ["wikidata_boxers", "labels_at", "TEXT"], ["boxers", "wikipedia_title", "TEXT"],
  ["bouts", "round_time", "TEXT"], ["bouts", "kd_red", "INTEGER"], ["bouts", "kd_blue", "INTEGER"], ["bouts", "odds_red", "REAL"],
  ["team_stints", "source_url", "TEXT"], ["team_stints", "note", "TEXT"],
  ["bouts", "odds_blue", "REAL"], ["bouts", "contract_lb", "REAL"], ["bouts", "title_org_id", "INTEGER"], ["bouts", "title_vacant", "INTEGER"],
];

function addMissingColumns(db: DatabaseSync) {
  for (const [table, col, type] of ADDED_COLUMNS) {
    const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!have.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}

/**
 * Changes whenever the data does. `PRAGMA data_version` moves when ANOTHER connection commits (a CLI importer, the
 * headshot resolver); this connection's own writes don't move it, so the latest ingest run id covers a re-ingest here.
 * Two one-row lookups: cheap enough to call on every request, and what the world and coverage caches key on.
 */
export function dbVersion(db: DatabaseSync): string {
  const dv = (db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;
  const run = (db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM ingest_runs").get() as { m: number }).m;
  return `${dv}.${run}.${g.__ringsideBump ?? 0}`;
}

const g = globalThis as unknown as { __ringsideDb?: DatabaseSync; __ringsideReady?: Promise<void>; __ringsideBump?: number };

/** Our own writes do not move PRAGMA data_version, so code that changes the data on this connection (approving a community edit) calls this to make the cached world rebuild. */
export const bumpDbVersion = () => { g.__ringsideBump = (g.__ringsideBump ?? 0) + 1; };

/** Replays approved community edits (accounts database) into this database. Never lets a problem with the accounts file stop the site opening. */
function syncCommunity(db: DatabaseSync) {
  try { applyContributions(db); } catch (e) { console.error("community edits not applied:", (e as Error).message); }
  // accepted corrections to the vendor's values (a fresh or restored database has not had them applied); a corrected result changes ratings
  try { if (applyCorrections(db).boutsChanged) recomputeRatings(db); } catch (e) { console.error("corrections not applied:", (e as Error).message); }
}

/** Opens the DB, creating and seeding it from the configured provider on first run. */
export async function getDb(): Promise<DatabaseSync> {
  if (!g.__ringsideDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    // Tiny forward-only migration for databases created before a column existed.
    const cols = (db.prepare("PRAGMA table_info(boxers)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("photo_credit")) db.exec("ALTER TABLE boxers ADD COLUMN photo_credit TEXT");
    addMissingColumns(db);
    syncNamesFromFile(db); // the committed Arabic names (i18n/names.ar.json) into this database
    syncCommunity(db);
    g.__ringsideDb = db;
  }
  const db = g.__ringsideDb;
  if (!g.__ringsideReady) {
    const count = (db.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c;
    // RINGSIDE_NO_SEED lets a script (the scale benchmark, the vendor backfill) load its own data into an empty database instead
    const seed = count === 0 && !process.env.RINGSIDE_NO_SEED;
    // a licensed feed is thousands of requests and costs money: never start one because somebody opened a page (the health check would trigger it too)
    if (seed && process.env.BOXING_PROVIDER === "licensed") {
      g.__ringsideReady = Promise.reject(new Error("This database is empty and BOXING_PROVIDER=licensed. The app does not fetch a licensed history on a page view: fill the database first with `npm run vendor:backfill` (docs/real-data-runbook.md), then start the app."));
      g.__ringsideReady.catch(() => {}); // reported to the caller below; no unhandled rejection
    } else g.__ringsideReady = seed ? ingest(db).then(() => { syncCommunity(db); }) : Promise.resolve();
  }
  try {
    await g.__ringsideReady;
  } catch (e) {
    g.__ringsideReady = undefined; // don't cache a failed seed: retry on the next request
    throw e;
  }
  return db;
}
