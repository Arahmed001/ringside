import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupDatabases, MANIFEST, verifyBackup } from "../lib/backup";
import { restoreBackup, siteMightBeRunning, type RestoreOptions } from "../lib/restore";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ringside-restore-"));
const SPORTS = ["boxers", "bouts", "events", "prediction_snapshots"], ACCOUNTS = ["users", "picks", "contributions"];
/** A database whose every row says which "generation" it belongs to, so a test can tell old data from restored data. */
function make(file: string, tables: string[], gen: string, wal = true) {
  const db = new DatabaseSync(file);
  if (wal) db.exec("PRAGMA journal_mode = WAL");
  for (const t of tables) { db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, v TEXT)`); for (let i = 0; i < 3; i++) db.prepare(`INSERT INTO ${t} (v) VALUES (?)`).run(`${gen}-${t}-${i}`); }
  return db;
}
const read = (file: string, table = "boxers") => { const db = new DatabaseSync(file, { readOnly: true }); try { return (db.prepare(`SELECT v FROM ${table} ORDER BY id`).all() as { v: string }[]).map((r) => r.v); } finally { db.close(); } };
/** Every file under a folder with its bytes, so "nothing changed" can be asserted exactly. */
const snapshot = (dir: string): Record<string, string> => fs.existsSync(dir) ? Object.fromEntries(fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => { const f = path.join(e.parentPath, e.name); return [path.relative(dir, f), fs.readFileSync(f).toString("base64")]; }).sort()) : {};
const gen = (g: string, t: string) => [0, 1, 2].map((i) => `${g}-${t}-${i}`);

/** A "live" data folder (generation "old") and a verified backup of a different one ("new"). */
function world() {
  const d = tmp(), data = path.join(d, "data"), src = path.join(d, "src");
  fs.mkdirSync(data); fs.mkdirSync(src);
  make(path.join(src, "ringside.db"), SPORTS, "new").close(); make(path.join(src, "accounts.db"), ACCOUNTS, "new").close(); fs.writeFileSync(path.join(src, "model-fit.json"), '{"gen":"new"}');
  const backup = backupDatabases({ root: path.join(d, "backups"), files: [{ name: "ringside", path: path.join(src, "ringside.db") }, { name: "accounts", path: path.join(src, "accounts.db"), private: true }], extra: [{ name: "model-fit", path: path.join(src, "model-fit.json") }], now: new Date("2026-10-01T00:00:00Z") }).dir;
  make(path.join(data, "ringside.db"), SPORTS, "old").close(); make(path.join(data, "accounts.db"), ACCOUNTS, "old").close(); fs.writeFileSync(path.join(data, "model-fit.json"), '{"gen":"old"}');
  const opts: RestoreOptions = {
    backupDir: backup, safetyRoot: path.join(data, "backups", "before-restore"), now: new Date("2026-10-06T10:00:00Z"), detectRunning: () => [],
    databases: [{ name: "ringside", path: path.join(data, "ringside.db") }, { name: "accounts", path: path.join(data, "accounts.db"), private: true }],
    extra: [{ name: "model-fit", path: path.join(data, "model-fit.json") }],
  };
  return { d, data, backup, opts };
}

test("a good backup restores: both databases hold the backup's contents, old WAL files are gone, the accounts file is private", async () => {
  const w = world();
  fs.writeFileSync(path.join(w.data, "accounts.db-wal"), "stale"); fs.writeFileSync(path.join(w.data, "accounts.db-shm"), "stale");
  const r = await restoreBackup(w.opts);
  assert.deepEqual(r.refused, []); assert.ok(r.ok);
  assert.deepEqual(read(path.join(w.data, "ringside.db")), gen("new", "boxers"));
  assert.deepEqual(read(path.join(w.data, "accounts.db"), "users"), gen("new", "users"));
  assert.equal(fs.readFileSync(path.join(w.data, "model-fit.json"), "utf8"), '{"gen":"new"}');
  assert.deepEqual(fs.readdirSync(w.data).filter((n) => /-wal$|-shm$|restore-/.test(n)), [], "no stale -wal/-shm or staging files");
  assert.equal(fs.statSync(path.join(w.data, "accounts.db")).mode & 0o077, 0);
  assert.match(r.counts.join(" "), /3 fighters/); assert.match(r.counts.join(" "), /3 accounts/);
  assert.ok(r.did.join("\n").includes(r.safetyDir!));
});

test("the safety copy holds the old data, including what was only in the WAL, and undo puts it all back", async () => {
  const w = world();
  const live = new DatabaseSync(path.join(w.data, "ringside.db")); live.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0"); live.prepare("INSERT INTO boxers (v) VALUES ('old-in-wal')").run();
  const r = await restoreBackup(w.opts);
  assert.ok(r.ok && r.safetyDir, r.refused.join("\n"));
  assert.ok(r.safetyDir!.startsWith(path.join(w.data, "backups", "before-restore")));
  assert.deepEqual(verifyBackup(r.safetyDir!, { requireChecksums: true }), []);
  assert.ok(read(path.join(r.safetyDir!, "ringside.db")).includes("old-in-wal"), "the committed-but-uncheckpointed row is in the safety copy");
  live.close();
  const undo = await restoreBackup({ ...w.opts, backupDir: r.safetyDir!, now: new Date("2026-10-06T11:00:00Z") });
  assert.ok(undo.ok, undo.refused.join("\n"));
  assert.deepEqual(read(path.join(w.data, "ringside.db")), [...gen("old", "boxers"), "old-in-wal"]);
  assert.deepEqual(read(path.join(w.data, "accounts.db"), "users"), gen("old", "users"));
  assert.equal(fs.readFileSync(path.join(w.data, "model-fit.json"), "utf8"), '{"gen":"old"}');
});

test("a corrupted, truncated, tampered or checksum-less backup is refused and the current data is untouched", async () => {
  for (const damage of ["flip", "truncate", "delete-file", "no-manifest", "extra-db"]) {
    const w = world(); const before = snapshot(w.data);
    const f = path.join(w.backup, "ringside.db"); const buf = fs.readFileSync(f);
    if (damage === "flip") { for (let i = 4096; i < 8192; i++) buf[i] ^= 0xff; fs.writeFileSync(f, buf); }
    if (damage === "truncate") fs.writeFileSync(f, buf.subarray(0, buf.length - 4096));
    if (damage === "delete-file") fs.rmSync(path.join(w.backup, "accounts.db"));
    if (damage === "no-manifest") fs.rmSync(path.join(w.backup, MANIFEST));
    if (damage === "extra-db") make(path.join(w.backup, "other.db"), ["t"], "x", false).close();
    const r = await restoreBackup(w.opts);
    assert.ok(!r.ok && r.refused.length, `${damage} must be refused`);
    assert.deepEqual(snapshot(w.data), before, `${damage}: nothing under the data folder changed (no safety copy, no staging files)`);
  }
  const w = world(); fs.rmSync(path.join(w.backup, MANIFEST));
  assert.ok((await restoreBackup({ ...w.opts, allowUnchecked: true })).ok, "an old backup with no checksum list restores only when told so");
});

test("the site possibly running refuses unless told otherwise", async () => {
  const w = world(); const before = snapshot(w.data);
  const running = () => ["process 123 has ringside.db open"];
  const r = await restoreBackup({ ...w.opts, detectRunning: running });
  assert.ok(!r.ok); assert.match(r.refused.join("\n"), /might be running/); assert.match(r.refused.join("\n"), /--even-if-running/);
  assert.deepEqual(snapshot(w.data), before);
  assert.ok((await restoreBackup({ ...w.opts, detectRunning: running, allowRunning: true })).ok);
});

test("the running check sees a program holding the database open and a listening port, and nothing on a quiet folder", async () => {
  const w = world(); const live = path.join(w.data, "ringside.db");
  assert.deepEqual(await siteMightBeRunning([live], 1), [], "quiet");
  const procOk = fs.existsSync("/proc/self/fd");
  if (procOk) {
    const child = spawn(process.execPath, ["-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(${JSON.stringify(live)});d.exec("PRAGMA journal_mode = WAL");console.log("ready");setTimeout(()=>{},20000)`], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await new Promise((ok) => child.stdout!.once("data", ok));
      const got = await siteMightBeRunning([live], 1);
      assert.ok(got.some((l) => /process \d+\) has ringside\.db open/.test(l)), "a program holding it open");
    } finally { child.kill(); await new Promise((ok) => child.once("exit", ok)); }
    assert.deepEqual(await siteMightBeRunning([live], 1), [], "a script that left -wal/-shm behind but has exited is not a running site (where /proc can be read)");
  } else {
    fs.writeFileSync(`${live}-wal`, "x");
    assert.ok((await siteMightBeRunning([live], 1)).some((l) => /-wal exists/.test(l)), "no /proc: the leftover file is the sign");
  }
  const srv = net.createServer().listen(0, "127.0.0.1"); await new Promise((ok) => srv.once("listening", ok));
  const port = (srv.address() as { port: number }).port;
  assert.ok((await siteMightBeRunning([], port)).some((l) => l.includes(`port ${port}`)), "a listening port");
  srv.close();
});

test("a crash before or during the swap leaves the old data intact and no staging files behind", async () => {
  for (const when of ["afterStage", "secondSwap"] as const) {
    const w = world();
    const live = path.join(w.data, "ringside.db");
    const hooks = when === "afterStage" ? { afterStage: () => { throw new Error("power cut"); } } : { beforeSwap: (i: number) => { if (i === 1) throw new Error("power cut"); } };
    const r = await restoreBackup({ ...w.opts, hooks });
    assert.ok(!r.ok); assert.match(r.refused.join(" "), /power cut/); assert.match(r.refused.join(" "), /put back/);
    assert.deepEqual(read(live), gen("old", "boxers"), `${when}: fight data is the old data`);
    assert.deepEqual(read(path.join(w.data, "accounts.db"), "users"), gen("old", "users"));
    assert.equal(fs.readFileSync(path.join(w.data, "model-fit.json"), "utf8"), '{"gen":"old"}');
    assert.deepEqual(fs.readdirSync(w.data).filter((n) => /restore-/.test(n)), [], "no staging or set-aside files");
    assert.ok(r.safetyDir && fs.existsSync(r.safetyDir), "the safety copy was made before anything was risked");
    assert.ok((await restoreBackup({ ...w.opts, now: new Date("2026-10-06T12:00:00Z") })).ok, "and a second try succeeds");
  }
});

test("staging files from a real crash are cleaned up by the next run, and a set-aside original is never deleted", async () => {
  const w = world();
  fs.writeFileSync(path.join(w.data, "ringside.db.restore-tmp"), "half a file");
  assert.ok((await restoreBackup(w.opts)).ok);
  assert.ok(!fs.existsSync(path.join(w.data, "ringside.db.restore-tmp")));
  const x = world(); fs.writeFileSync(path.join(x.data, "ringside.db.restore-old"), "the old data");
  const r = await restoreBackup(x.opts);
  assert.ok(!r.ok); assert.match(r.refused.join(" "), /set the old file aside/);
  assert.equal(fs.readFileSync(path.join(x.data, "ringside.db.restore-old"), "utf8"), "the old data");
  assert.deepEqual(read(path.join(x.data, "ringside.db")), gen("old", "boxers"));
});

test("a dry run writes nothing at all, and says what it would do", async () => {
  const w = world(); const before = snapshot(w.data), backupBefore = snapshot(w.backup);
  const r = await restoreBackup({ ...w.opts, dryRun: true });
  assert.ok(r.ok && r.dryRun); assert.match(r.did.join("\n"), /would replace/); assert.match(r.did.join("\n"), /nothing was changed/);
  assert.deepEqual(snapshot(w.data), before); assert.deepEqual(snapshot(w.backup), backupBefore);
  assert.ok(!fs.existsSync(w.opts.safetyRoot), "not even the safety folder");
  const bad = world(); fs.writeFileSync(path.join(bad.backup, "ringside.db"), "junk");
  assert.ok(!(await restoreBackup({ ...bad.opts, dryRun: true })).ok, "a dry run also refuses a bad backup");
});

test("a backup without accounts leaves the current accounts alone; an empty data folder restores with nothing to save", async () => {
  const w = world(); fs.rmSync(path.join(w.backup, "accounts.db"));
  fs.writeFileSync(path.join(w.backup, MANIFEST), fs.readFileSync(path.join(w.backup, MANIFEST), "utf8").split("\n").filter((l) => !l.includes("accounts.db")).join("\n"));
  const r = await restoreBackup(w.opts); assert.ok(r.ok, r.refused.join("\n"));
  assert.deepEqual(read(path.join(w.data, "accounts.db"), "users"), gen("old", "users"));
  const e = world(); fs.rmSync(e.data, { recursive: true });
  const r2 = await restoreBackup({ ...e.opts, safetyRoot: path.join(e.d, "safety") });
  assert.ok(r2.ok && r2.safetyDir === null, r2.refused.join("\n")); assert.deepEqual(read(path.join(e.data, "ringside.db")), gen("new", "boxers"));
});

test("what it reports is paths, sizes and counts: never a row or a secret", async () => {
  const w = world();
  const r = await restoreBackup(w.opts);
  assert.ok(!/new-users|old-users|new-boxers|old-boxers|pw_hash|ANTHROPIC/.test(JSON.stringify(r)));
});
