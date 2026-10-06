/**
 * A stand-in for the nightly update, for the capacity test of a data change under traffic (docs/capacity.md, "A data update while serving"):
 *
 *   npm run capacity -- --base ... --pid ... --steps 5 --seconds 70 --event-at 20 --event-cmd "tsx scripts/capacity-update.ts <copy>/real.db"
 *
 * It is another process writing to the database a server is reading, in the three separate commits the real update makes (its fights, its recomputed ratings,
 * its run record), a second and a half apart. The real `vendor:backfill --update` does the same against the stand-in vendor (`npm run vendor:rehearse`); this
 * one needs no vendor and no network and does the same thing every time. It changes ratings by a point and adds a run record: SYNTHETIC COPIES ONLY.
 * It refuses the default database (data/ringside.db) and a path that is not given.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [file, gap = "1500"] = process.argv.slice(2);
if (!file) { console.error("usage: tsx scripts/capacity-update.ts <path to a COPY of a synthetic database> [ms between commits]"); process.exit(2); }
if (path.resolve(file) === path.resolve("data", "ringside.db")) { console.error("refusing the default database: point this at a copy made for the capacity test"); process.exit(2); }
if (!fs.existsSync(file)) { console.error(`no such file: ${file}`); process.exit(2); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const db = new DatabaseSync(file);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
const t0 = Date.now(), at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function main() {
  // 1. the fights: a few fighters' rows change
  db.exec("BEGIN");
  for (const r of db.prepare("SELECT id FROM boxers WHERE active = 1 ORDER BY id LIMIT 300").all() as { id: number }[]) db.prepare("UPDATE boxers SET nickname = COALESCE(nickname, '') WHERE id = ?").run(r.id);
  db.exec("COMMIT");
  console.log(`updating: commit 1 (fights) at ${at()}`);
  await sleep(Number(gap));
  // 2. the recomputed ratings: every fighter's rating moves a little
  db.exec("BEGIN"); db.exec("UPDATE boxers SET rating = rating + (id % 3) - 1"); db.exec("COMMIT");
  console.log(`updating: commit 2 (ratings) at ${at()}`);
  await sleep(Number(gap));
  // 3. the run record
  db.prepare("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES (?, 'capacity-test', 0, 0, 0, '{}', '{}')").run(new Date().toISOString());
  console.log(`updating: commit 3 (run record) at ${at()}`);
  db.close();
  console.log("after the update: done");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
