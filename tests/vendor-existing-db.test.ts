import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { writeKeyFile } from "../lib/vendor-fetch";
import { makeWorld, serveMockVendor } from "../lib/vendor-mock";
import { confirmPrompt, databaseFiles, existingWarning, AUDIT_FAILED_EXIT } from "../lib/vendor-load";

/**
 * Load day, with an old database already in the way (round 132). The owner's ~/ringside-real/real.db was made by an earlier version of the importer. A re-load updates it in
 * place and never removes a fight the importer now leaves out, so the old leftovers stay and the audit fails. The load must say so BEFORE the owner types LOAD, and the way out
 * it names (delete the three files, load again from the cache) must work.
 */
const root = path.resolve(__dirname, "..");
const LOCKS = fs.mkdtempSync(path.join(os.tmpdir(), "vlocks-"));
const go = (script: string, args: string[], env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const c = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd: root, env: { ...process.env, RINGSIDE_LOCK_DIR: LOCKS, BOXING_API_KEY: "", BOXING_API_STORAGE_CONFIRMED: "", RINGSIDE_NO_SEED: "1", RINGSIDE_NOW: "2026-10-03", ...env } });
  let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
  c.on("close", (code) => resolve({ code, out }));
});

test("the words: a warning that names the three files, a prompt that says 'in place' only when it is", () => {
  const w = existingWarning("/x/real.db").join("\n");
  assert.match(w, /WARNING: this database already exists/); assert.match(w, /never removes a fight an earlier load took/); assert.match(w, /delete \/x\/real\.db \/x\/real\.db-wal \/x\/real\.db-shm/); assert.match(w, /run this command again for a clean load/);
  assert.deepEqual(databaseFiles("/x/a.db"), ["/x/a.db", "/x/a.db-wal", "/x/a.db-shm"]);
  assert.match(confirmPrompt("/x/real.db", true), /Type LOAD to UPDATE \/x\/real\.db IN PLACE/); assert.match(confirmPrompt("/x/real.db", false), /Type LOAD to write this league into \/x\/real\.db/);
  assert.ok(!/IN PLACE/.test(confirmPrompt("/x/real.db", false)));
});

test("an old database in the way: a first load is quiet, a re-load warns first, keeps what the old load left (and the audit fails on it), and deleting the files and loading again is clean", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vexisting-")), keyFile = path.join(d, ".key"), cache = path.join(d, "cache"), db = path.join(d, "real.db");
  const secret = "existing-test-key-" + "k".repeat(32);
  writeKeyFile(keyFile, secret);
  const vendor = await serveMockVendor(makeWorld({ fighters: 120, fights: 400, upcoming: 0, seed: 8 }), { key: secret, offsetLimit: 10_000, beyond: "reject" });
  const base = ["--key-file", keyFile, "--cache-dir", cache, "--per-hour", "3600000", "--gap-ms", "0"], env = { BOXING_API_URL: vendor.url, DATABASE_PATH: db };
  try {
    const fetched = await go("scripts/vendor-fetch.ts", [...base, "--no-caffeinate"], env); assert.ok(fetched.code === 0 || fetched.code === 1, fetched.out.slice(-400));
    const first = await go("scripts/vendor-load.ts", [...base, "--storage-confirmed", "--yes"], env);
    assert.equal(first.code, 0, first.out.slice(-800)); assert.ok(!/already exists/.test(first.out), "a first load into a new file has no warning"); assert.match(first.out, /database: .*real\.db  \(new\)/);
    // what an older importer left behind: an Olympic card
    const x = new DatabaseSync(db); x.prepare("INSERT INTO events (external_id, name, date) VALUES ('old-games', '2016 Rio Olympics: Boxing Day 4', '2016-08-12')").run(); x.close();
    const again = await go("scripts/vendor-load.ts", [...base, "--storage-confirmed", "--yes"], env);
    assert.match(again.out, /WARNING: this database already exists/); assert.ok(again.out.indexOf("WARNING: this database already exists") < again.out.indexOf("step 1: the check"), "said before anything is checked or written");
    assert.match(again.out, new RegExp(`delete ${db.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} .*-wal .*-shm`));
    assert.equal(again.code, AUDIT_FAILED_EXIT, "the load worked and the audit failed on what the old load left"); assert.match(again.out, /FAIL\s+no amateur or multi-sport event is on the record/); assert.match(again.out, /2016 Rio Olympics/);
    const y = new DatabaseSync(db, { readOnly: true }); assert.equal((y.prepare("SELECT COUNT(*) n FROM events WHERE external_id = 'old-games'").get() as { n: number }).n, 1, "the re-load did not remove it"); y.close();
    // the way out the warning names
    for (const f of databaseFiles(db)) fs.rmSync(f, { force: true });
    const clean = await go("scripts/vendor-load.ts", [...base, "--storage-confirmed", "--yes"], env);
    assert.equal(clean.code, 0, clean.out.slice(-800)); assert.match(clean.out, /The audit passed/); assert.ok(!/already exists/.test(clean.out));
    assert.ok(!clean.out.includes(secret), "the key is nowhere in the output");
  } finally { await vendor.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test("the confirmation prompt is built from whether the file exists, and the status page names the hazard when the cache is complete", () => {
  const src = fs.readFileSync(path.join(root, "scripts/vendor-load.ts"), "utf8");
  assert.match(src, /ask\(confirmPrompt\(plan\.database, existed\)\)/, "the typed confirmation says 'in place' when it will be");
  assert.match(src, /if \(existed\) for \(const l of existingWarning\(plan\.database\)\)/);
  assert.ok(src.indexOf("existingWarning(plan.database)") < src.indexOf('"step 1: the check'), "before step 1");
  const status = fs.readFileSync(path.join(root, "lib/vendor-status.ts"), "utf8");
  assert.match(status, /the cache is complete\./); assert.match(status, /delete it and its -wal and -shm files first/, "the status tells you what to do about an old database before it tells you to load");
  assert.match(fs.readFileSync(path.join(root, "docs/load-day.md"), "utf8"), /A database from an earlier load is in the way/);
});
