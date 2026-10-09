import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { shipDatabase } from "../lib/ship";
import { MANIFEST, verifyBackup } from "../lib/backup";
import { restoreBackup } from "../lib/restore";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ringside-ship-"));
function make(file: string, tables: string[], gen: string, n = 3) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  for (const t of tables) { db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, v TEXT)`); for (let i = 0; i < n; i++) db.prepare(`INSERT INTO ${t} (v) VALUES (?)`).run(`${gen}-${t}-${i}`); }
  return db;
}
const SPORTS = ["boxers", "bouts", "events", "prediction_snapshots"], ACCOUNTS = ["users", "picks", "contributions"];
const read = (file: string, t: string) => { const db = new DatabaseSync(file, { readOnly: true }); try { return (db.prepare(`SELECT v FROM ${t} ORDER BY id`).all() as { v: string }[]).map((r) => r.v); } finally { db.close(); } };

test("a shipped folder holds the sports database and its checksums only, verifies, and leaves the source alone", () => {
  const d = tmp(), src = path.join(d, "real.db");
  const live = make(src, SPORTS, "real", 5); // open writer: the WAL holds rows the main file does not
  const before = fs.statSync(src).size;
  const r = shipDatabase({ database: src, outRoot: path.join(d, "ship"), now: new Date("2026-10-09T12:00:00Z"), minFighters: 1 });
  assert.deepEqual(r.problems, []);
  assert.equal(path.basename(r.dir), "2026-10-09T12-00-00Z");
  assert.deepEqual(fs.readdirSync(r.dir).sort(), [MANIFEST, "ringside.db"], "no accounts, no model file");
  assert.deepEqual(verifyBackup(r.dir, { requireChecksums: true }), []);
  assert.equal(read(path.join(r.dir, "ringside.db"), "boxers").length, 5);
  assert.deepEqual(r.counts, ["5 fighters", "5 fights", "5 cards"]);
  live.close(); assert.ok(fs.statSync(src).size >= before);
});

test("a demo-sized or missing or foreign database is refused, and nothing is written", () => {
  const d = tmp(), small = path.join(d, "small.db");
  make(small, SPORTS, "demo", 3).close();
  const r = shipDatabase({ database: small, outRoot: path.join(d, "ship") });
  assert.match(r.problems[0], /demo or a partial database/);
  assert.equal(fs.existsSync(path.join(d, "ship")), false);
  assert.match(shipDatabase({ database: path.join(d, "none.db"), outRoot: path.join(d, "ship") }).problems[0], /no database at/);
  const other = path.join(d, "other.db"); new DatabaseSync(other).close();
  assert.match(shipDatabase({ database: other, outRoot: path.join(d, "ship") }).problems[0], /not a Ringside database/);
});

test("restoring a shipped folder replaces the sports data and leaves the host's accounts exactly as they were", async () => {
  const d = tmp(), host = path.join(d, "data"); fs.mkdirSync(host);
  make(path.join(host, "ringside.db"), SPORTS, "demo").close(); make(path.join(host, "accounts.db"), ACCOUNTS, "people").close();
  make(path.join(d, "real.db"), SPORTS, "real").close();
  const s = shipDatabase({ database: path.join(d, "real.db"), outRoot: path.join(d, "ship"), minFighters: 1 });
  const res = await restoreBackup({
    backupDir: s.dir, databases: [{ name: "ringside", path: path.join(host, "ringside.db") }, { name: "accounts", path: path.join(host, "accounts.db"), private: true }],
    safetyRoot: path.join(host, "backups", "before-restore"), detectRunning: () => [],
  });
  assert.deepEqual(res.refused, []);
  assert.deepEqual(read(path.join(host, "ringside.db"), "boxers"), [0, 1, 2].map((i) => `real-boxers-${i}`));
  assert.deepEqual(read(path.join(host, "accounts.db"), "users"), [0, 1, 2].map((i) => `people-users-${i}`));
  assert.ok(res.safetyDir, "the demo data was saved first");
});
