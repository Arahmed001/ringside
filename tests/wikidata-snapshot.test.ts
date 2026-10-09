import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

const cleanup = tempDb("wikidata-snapshot");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-wdsnap-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });
let db: DatabaseSync; let wd: typeof import("../lib/importers/wikidata");
before(async () => { wd = await import("../lib/importers/wikidata"); db = await (await import("../lib/db")).getDb(); });
const rows = () => db.prepare("SELECT * FROM wikidata_boxers ORDER BY qid").all() as Record<string, unknown>[];

test("the staged Wikidata boxers are kept beside the database and come back into an empty table after a clean reload, without the links to our fighters (round 138)", () => {
  const file = path.join(dir, "wikidata-staging.json");
  db.exec("DELETE FROM wikidata_boxers");
  const ins = db.prepare("INSERT INTO wikidata_boxers (qid, name, birth_year, country, boxrec_id, matched_boxer_id, match_method, fetched_at, ar_label, awards, extras_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  ins.run("Q1", "Some Boxer", 1980, "Mexico", "123", 77, "name+year", "2026-10-09T10:00:00Z", "ملاكم", '["x"]', "2026-10-09T10:00:00Z");
  ins.run("Q2", "Another", null, null, null, null, null, "2026-10-09T10:00:00Z", null, null, null);
  assert.equal(wd.saveStagingSnapshot(db, file), 2);
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes(".tmp-")).length, 0, "no temporary file left behind");
  db.exec("DELETE FROM wikidata_boxers");
  assert.equal(wd.restoreStagingSnapshot(db, file), 2);
  const [a, b] = rows();
  assert.deepEqual([a.qid, a.name, a.birth_year, a.country, a.boxrec_id, a.ar_label, a.awards, a.fetched_at], ["Q1", "Some Boxer", 1980, "Mexico", "123", "ملاكم", '["x"]', "2026-10-09T10:00:00Z"]);
  assert.deepEqual([a.matched_boxer_id, a.match_method, b.matched_boxer_id], [null, null, null], "a new database numbers its fighters again: the link is made afresh by the next enrich");
  assert.equal(wd.restoreStagingSnapshot(db, file), 0, "a table that already has rows is left alone");
});

test("a snapshot that is old, unreadable, of another version or holds a bad id is not trusted, and an empty table is never saved over a good snapshot", () => {
  const file = path.join(dir, "s2.json"), row = { qid: "Q9", name: "N", fetched_at: "2026-10-09T10:00:00Z" };
  const write = (o: unknown) => fs.writeFileSync(file, typeof o === "string" ? o : JSON.stringify(o));
  db.exec("DELETE FROM wikidata_boxers");
  const now = Date.parse("2026-10-09T12:00:00Z");
  write({ version: 1, at: "2026-10-09T10:00:00Z", rows: [row, { qid: "Q9; DROP", name: "x" }, { name: "no id" }] });
  assert.equal(wd.restoreStagingSnapshot(db, file, 30, now), 1, "only the row with a real Wikidata id");
  db.exec("DELETE FROM wikidata_boxers");
  write({ version: 1, at: "2026-08-01T00:00:00Z", rows: [row] }); assert.equal(wd.restoreStagingSnapshot(db, file, 30, now), 0, "older than 30 days: Wikidata has changed");
  write({ version: 2, at: "2026-10-09T10:00:00Z", rows: [row] }); assert.equal(wd.restoreStagingSnapshot(db, file, 30, now), 0);
  write("not json"); assert.equal(wd.restoreStagingSnapshot(db, file, 30, now), 0);
  assert.equal(wd.restoreStagingSnapshot(db, path.join(dir, "missing.json"), 30, now), 0);
  const keep = path.join(dir, "keep.json"); fs.writeFileSync(keep, "GOOD");
  assert.equal(wd.saveStagingSnapshot(db, keep), 0); assert.equal(fs.readFileSync(keep, "utf8"), "GOOD", "nothing staged: the good snapshot is left alone");
  assert.equal(rows().length, 0);
});

test("the import script restores before it fetches and keeps after it has fetched, beside the database", () => {
  const s = fs.readFileSync("scripts/import-wikidata.ts", "utf8");
  assert.ok(s.indexOf("restoreStagingSnapshot(db, snapshot)") < s.indexOf("importWikidata(db"), "restore first");
  assert.match(s, /saveStagingSnapshot\(db, snapshot\)/); assert.match(s, /path\.dirname\(process\.env\.DATABASE_PATH/);
});
