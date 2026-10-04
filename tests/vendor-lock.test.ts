import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { acquireBackfillLock, releaseBackfillLock } from "../lib/vendor-backfill";

/**
 * The plan's hourly allowance belongs to the API key. The first real run lost hours because an old run, forgotten in another terminal, was spending the same
 * allowance. A second backfill with the same key on the same machine now refuses to start, and says which process holds the key.
 */
const KEY = "sk-lock-test-key-0123456789abcdef0123456789abcd";
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "bda-lock-"));

test("a free key is locked, a second live run is refused with the first one's process id and command, and a release frees it", () => {
  const d = dir();
  const file = acquireBackfillLock(KEY, { dir: d, pid: 1111, alive: () => true, command: "--plan --fighters 5000" });
  assert.ok(fs.existsSync(file));
  assert.ok(!fs.readFileSync(file, "utf8").includes(KEY), "the key itself is never written");
  assert.ok(!path.basename(file).includes(KEY.slice(0, 8)), "nor used in the file name");
  assert.throws(() => acquireBackfillLock(KEY, { dir: d, pid: 2222, alive: (p) => p === 1111 }), (e: Error) => /process 1111/.test(e.message) && /--plan --fighters 5000/.test(e.message) && /share the plan's hourly allowance/.test(e.message) && /pgrep -fl vendor-backfill/.test(e.message));
  releaseBackfillLock(file, 1111);
  assert.ok(!fs.existsSync(file));
  assert.doesNotThrow(() => acquireBackfillLock(KEY, { dir: d, pid: 2222, alive: () => true }), "free again");
});

test("a lock whose process is gone, or that cannot be read, is stale and is taken over; a run never blocks itself; another key is unaffected", () => {
  const d = dir();
  const file = acquireBackfillLock(KEY, { dir: d, pid: 1111, alive: () => true });
  assert.doesNotThrow(() => acquireBackfillLock(KEY, { dir: d, pid: 2222, alive: () => false }), "its process is gone");
  assert.equal((JSON.parse(fs.readFileSync(file, "utf8")) as { pid: number }).pid, 2222, "and the lock is now the new run's");
  fs.writeFileSync(file, "not json");
  assert.doesNotThrow(() => acquireBackfillLock(KEY, { dir: d, pid: 3333, alive: () => true }), "an unreadable lock is stale");
  assert.doesNotThrow(() => acquireBackfillLock(KEY, { dir: d, pid: 3333, alive: () => true }), "the same process may take its own lock again");
  assert.doesNotThrow(() => acquireBackfillLock(KEY + "-other", { dir: d, pid: 4444, alive: () => true }), "a different key has its own lock");
  releaseBackfillLock(file, 9999);
  assert.ok(fs.existsSync(file), "a release by a process that does not hold the lock leaves it alone");
});

test("the real command: a run is refused while another holds the key, and a stale lock does not stop it", async () => {
  const d = dir();
  const run = (extra: Record<string, string> = {}) => new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-backfill.ts", "--plan", "--max-requests", "1"], {
      env: { ...process.env, BOXING_API_KEY: KEY, BOXING_API_URL: "http://127.0.0.1:9", RINGSIDE_LOCK_DIR: d, BOXING_API_STORAGE_CONFIRMED: "1", ...extra }, cwd: process.cwd(),
    });
    let out = ""; child.stdout.on("data", (x) => (out += x)); child.stderr.on("data", (x) => (out += x));
    child.on("close", (code) => resolve({ code, out }));
  });
  // this test process stands in for the other run: it is alive, and it is not the command's own process
  const held = acquireBackfillLock(KEY, { dir: d, pid: process.pid, alive: () => true, command: "--check --fighters 5000" });
  const refused = await run();
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, new RegExp(`Another backfill is already running with this API key \\(process ${process.pid}`));
  assert.match(refused.out, /--check --fighters 5000/);
  releaseBackfillLock(held);
  fs.writeFileSync(held, JSON.stringify({ pid: 2_000_000_000, startedAt: "2026-01-01T00:00:00Z", command: "old" })); // a process that cannot exist
  const stale = await run();
  assert.doesNotMatch(stale.out, /Another backfill is already running/, "a stale lock is taken over (the run then fails for its own reasons: nothing is listening)");
  assert.ok(!fs.existsSync(held), "and a finished run gives its lock back");
});
