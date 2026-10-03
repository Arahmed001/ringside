import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupDatabases, stampOf, verifyBackup } from "../lib/backup";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ringside-backup-"));
function make(file: string, tables: string[], rows = 3) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  for (const t of tables) { db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, v TEXT)`); for (let i = 0; i < rows; i++) db.prepare(`INSERT INTO ${t} (v) VALUES (?)`).run(`${t}-${i}`); }
  return db;
}
const SPORTS = ["boxers", "bouts", "events", "prediction_snapshots"], ACCOUNTS = ["users", "picks", "contributions"];

test("a backup is a consistent copy that can be opened, and it is taken while the app keeps writing", () => {
  const d = tmp();
  const live = make(path.join(d, "ringside.db"), SPORTS), acc = make(path.join(d, "accounts.db"), ACCOUNTS);
  // an open writer with uncommitted-to-the-main-file data in the WAL: a plain file copy would miss or tear it
  live.prepare("INSERT INTO boxers (v) VALUES ('written just before the backup')").run();
  const r = backupDatabases({ root: path.join(d, "backups"), files: [{ name: "ringside", path: path.join(d, "ringside.db") }, { name: "accounts", path: path.join(d, "accounts.db"), private: true }], now: new Date("2026-10-03T12:00:00Z") });
  assert.equal(path.basename(r.dir), "2026-10-03T12-00-00Z");
  assert.deepEqual(r.files.map((f) => [f.name, f.integrity]), [["ringside", "ok"], ["accounts", "ok"]]);
  live.prepare("INSERT INTO boxers (v) VALUES ('after')").run(); // the app carries on
  const copy = new DatabaseSync(path.join(r.dir, "ringside.db"), { readOnly: true });
  assert.equal((copy.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c, 4, "includes the write that was only in the WAL, and not the later one");
  copy.close();
  assert.deepEqual(verifyBackup(r.dir), []);
  assert.equal((fs.statSync(path.join(r.dir, "accounts.db")).mode & 0o077), 0, "the accounts copy is readable by its owner only");
  live.close(); acc.close();
});

test("a missing accounts file is skipped, not an error; extras are copied; two backups in one second refuse", () => {
  const d = tmp();
  make(path.join(d, "ringside.db"), SPORTS).close(); fs.writeFileSync(path.join(d, "model-fit.json"), "{}");
  const now = new Date("2026-10-03T12:00:00Z");
  const args = { root: path.join(d, "b"), files: [{ name: "ringside", path: path.join(d, "ringside.db") }, { name: "accounts", path: path.join(d, "nope.db") }], extra: [{ name: "model-fit", path: path.join(d, "model-fit.json") }], now };
  const r = backupDatabases(args);
  assert.equal(r.files.length, 1); assert.match(r.skipped[0], /accounts/);
  assert.ok(fs.existsSync(path.join(r.dir, "model-fit.json")));
  assert.throws(() => backupDatabases(args), /already exists/);
});

test("old backups are pruned, and only folders that look like backups are ever deleted", () => {
  const d = tmp(); const root = path.join(d, "b");
  make(path.join(d, "ringside.db"), SPORTS).close();
  fs.mkdirSync(path.join(root, "my-notes"), { recursive: true }); fs.writeFileSync(path.join(root, "my-notes", "keep.txt"), "x"); fs.writeFileSync(path.join(root, "2020-01-01T00-00-00Z.txt"), "a file, not a folder");
  for (let day = 1; day <= 5; day++) backupDatabases({ root, files: [{ name: "ringside", path: path.join(d, "ringside.db") }], keep: 3, now: new Date(`2026-10-0${day}T00:00:00Z`) });
  assert.deepEqual(fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory() && n !== "my-notes").sort(), ["2026-10-03T00-00-00Z", "2026-10-04T00-00-00Z", "2026-10-05T00-00-00Z"], "the three newest remain");
  assert.ok(fs.existsSync(path.join(root, "my-notes", "keep.txt")) && fs.existsSync(path.join(root, "2020-01-01T00-00-00Z.txt")), "nothing else is touched");
  assert.equal(stampOf(new Date("2026-10-03T12:34:56.789Z")), "2026-10-03T12-34-56Z");
});

test("verify catches an empty folder, a damaged file and a missing table", () => {
  const d = tmp();
  assert.match(verifyBackup(path.join(d, "none"))[0], /no database files/);
  make(path.join(d, "ringside.db"), ["boxers"]).close();
  const lacking = verifyBackup(d);
  assert.ok(lacking.some((p) => /table bouts is missing/.test(p)) && lacking.some((p) => /prediction_snapshots/.test(p)), "the ledger table is required");
  const bad = tmp(); make(path.join(bad, "ringside.db"), SPORTS, 400).close();
  const buf = fs.readFileSync(path.join(bad, "ringside.db"));
  for (let i = 4096 * 2; i < 4096 * 3; i++) buf[i] = 0xff; // damage a page in the middle
  fs.writeFileSync(path.join(bad, "ringside.db"), buf);
  const problems = verifyBackup(bad);
  assert.ok(problems.length > 0, "damage must not pass as a good backup");
  assert.match(problems.join(" "), /integrity_check|cannot be read/);
});
