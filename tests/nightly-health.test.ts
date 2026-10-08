import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tempDb } from "./helpers";
import { diagnose, type Probe } from "../lib/doctor";
import { publicNightly, readStatus, statusPath, writeStatus, type NightlyStatus } from "../lib/nightly-status";

/**
 * What the nightly job's status file adds to /api/health, and to the doctor: a few facts, nothing sensitive, and no change to what `stale` means.
 */
const cleanup = tempDb("nightly-health");
after(cleanup);
const SECRET = "sk-THE-KEY-0123456789abcdef";
const file = statusPath(); // beside the throwaway database
const full = (o: Partial<NightlyStatus> = {}): NightlyStatus => ({
  version: 1, started: "2026-10-03T03:00:12.000Z", finished: "2026-10-03T03:02:40.000Z", result: "ok", exitCode: 0, exitMeaning: "done", next: "2026-10-04T03:00:00.000Z",
  steps: [
    { name: "backup", exitCode: 0, ok: true, message: `2026-10-03T03-00-12Z verified (ringside, accounts) in ${os.tmpdir()}/backups`, meaning: "done", seconds: 1.2 },
    { name: "update", exitCode: 0, ok: true, message: `applied: key ${SECRET} at /data/ringside.db`, meaning: "done", seconds: 90, peakMemoryMb: 331 },
    { name: "offsite", exitCode: null, ok: true, skipped: true, message: `rclone to s3://private-bucket/${SECRET}`, meaning: "not run", seconds: 0 },
  ], ...o,
});
const get = async () => { const { GET } = await import("../app/api/health/route"); const res = await GET(); return { res, text: await res.text() }; };

test("without the job nothing changes in /api/health", async () => {
  fs.rmSync(file, { force: true });
  const { res, text } = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(text).data).sort(), ["ageHours", "stale", "updatedAt"]);
});

test("with the job: its result and exit codes appear, and no message, no path, no key, no setting", async () => {
  writeStatus(file, full());
  const { res, text } = await get();
  assert.equal(res.status, 200);
  const data = JSON.parse(text).data;
  assert.deepEqual(Object.keys(data).sort(), ["ageHours", "nightly", "stale", "updatedAt"]);
  assert.deepEqual(data.nightly, { result: "ok", startedAt: "2026-10-03T03:00:12.000Z", finishedAt: "2026-10-03T03:02:40.000Z", exitCode: 0, steps: { backup: 0, update: 0, offsite: null }, next: "2026-10-04T03:00:00.000Z" });
  // the whole answer, read as text: nothing that could be a path, a key, a bucket, a message or a setting name
  for (const bad of [SECRET, "private-bucket", "rclone", "s3://", os.tmpdir(), path.dirname(file), "ringside.db", "/data", "message", "meaning", "peakMemory", "NIGHTLY", "BOXING_API_KEY", "verified", "applied"]) assert.ok(!text.includes(bad), `the health answer must not contain ${bad}`);
  assert.ok(!/\/[a-z]/i.test(text.replace(/"\d{4}-\d{2}-\d{2}T[\d:.]+Z"/g, "")), "no path-like text at all");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("`stale` keeps meaning what it meant: only the database decides, whatever the job says", async () => {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  const saved = process.env.BOXING_PROVIDER;
  const set = (iso: string) => { db.exec("DELETE FROM ingest_runs WHERE provider = 'boxing-data-api'"); db.prepare("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES (?, 'boxing-data-api', 0, 0, 0, '{}', '{}')").run(iso); };
  try {
    process.env.BOXING_PROVIDER = "licensed";
    set("2026-09-29T00:00:00.000Z"); // RINGSIDE_NOW is 2026-10-03: four days old
    writeStatus(file, full()); // the job says everything is fine
    let body = JSON.parse((await get()).text);
    assert.equal(body.data.stale, true, "a job reporting ok cannot hide old data");
    assert.equal(body.data.nightly.result, "ok");
    set("2026-10-03T00:00:00.000Z");
    writeStatus(file, full({ result: "failed", exitCode: 2, steps: [{ name: "update", exitCode: 2, ok: false, message: "x", meaning: "the vendor", seconds: 1 }] }));
    const r = await get();
    body = JSON.parse(r.text);
    assert.equal(r.res.status, 200, "a failed job is not a 503");
    assert.deepEqual([body.data.stale, body.data.nightly.result, body.data.nightly.exitCode, body.data.nightly.steps], [false, "failed", 2, { update: 2 }], "fresh data is fresh; the failure is shown beside it");
    assert.ok(r.text.includes('"stale":false'), "the text a monitor looks for is unchanged");
  } finally { if (saved === undefined) delete process.env.BOXING_PROVIDER; else process.env.BOXING_PROVIDER = saved; }
});

test("a file that is damaged, from another version, or a run killed long ago reads as none or as interrupted, never as an error", async () => {
  for (const junk of ["{not json", "[]", JSON.stringify({ version: 2, started: "2026-10-03T00:00:00Z", result: "ok", steps: [] }), JSON.stringify({ version: 1, started: "yesterday", result: "ok", steps: [] }), JSON.stringify({ version: 1, started: "2026-10-03T00:00:00Z", result: "great", steps: [] })]) {
    fs.writeFileSync(file, junk);
    assert.equal(readStatus(file), null, junk);
    const { res, text } = await get();
    assert.equal(res.status, 200);
    assert.ok(!("nightly" in JSON.parse(text).data));
  }
  writeStatus(file, full({ result: "running", finished: null, exitCode: null }));
  const day = Date.parse("2026-10-03T03:00:12.000Z");
  assert.equal(publicNightly(readStatus(file), day + 3_600_000)!.result, "running", "an hour in: still running");
  assert.equal(publicNightly(readStatus(file), day + 7 * 3_600_000)!.result, "interrupted", "seven hours in: its container died with it");
  assert.equal(publicNightly(null), null);
  fs.rmSync(file, { force: true });
});

test("the doctor reads the last result: ok, a failure, a failed off-host copy, and a schedule that never ran", () => {
  const probe = (n: NightlyStatus | null, withProbe = true): Probe => ({
    dir: () => ({ exists: true, writable: true }),
    db: () => ({ exists: true, quickCheck: "ok", lastUpdate: { at: "2026-10-03T06:17:00.000Z", provider: "boxing-data-api" }, tables: ["boxers", "events", "bouts", "users", "sessions", "picks"], rows: { boxers: 9, events: 9, bouts: 9, users: 1 }, mode: 0o600 }),
    file: () => true, newestBackup: () => new Date("2026-10-03T03:00:00Z"), freeBytes: () => 50 * 1024 ** 3,
    ...(withProbe ? { nightly: () => publicNightly(n, Date.parse("2026-10-03T12:00:00Z")) } : {}),
  });
  const run = (n: NightlyStatus | null, env: Record<string, string> = {}, withProbe = true) => diagnose({ DATABASE_PATH: "/data/ringside.db", BOXING_PROVIDER: "licensed", BOXING_API_KEY: "k".repeat(50), ...env }, probe(n, withProbe), { cwd: "/srv", now: new Date("2026-10-03T12:00:00Z"), production: true });
  const lv = (fs: ReturnType<typeof run>, id: string) => fs.filter((x) => x.id === id).map((x) => x.level);
  assert.deepEqual(lv(run(full()), "nightly"), ["ok"]);
  const bad = run(full({ result: "failed", exitCode: 2 }));
  assert.deepEqual(lv(bad, "nightly"), ["warn"]);
  assert.match(bad.find((x) => x.id === "nightly")!.message, /exit code 2, the vendor is unreachable or refused/);
  assert.ok(!JSON.stringify(bad).includes(SECRET));
  assert.deepEqual(lv(run(full({ result: "warning" })), "nightly"), ["warn"]);
  assert.deepEqual(lv(run(null, { NIGHTLY_SCHEDULE: "03:30" }), "nightly"), ["info"]);
  assert.deepEqual(lv(run(null), "nightly"), [], "a volume that never used the job says nothing about it");
  assert.deepEqual(lv(run(null, {}, false), "nightly"), [], "a probe without the reader says nothing either");
  assert.deepEqual(lv(run(null, { NIGHTLY_SCHEDULE: "03:30" }, false), "nightly-schedule"), ["ok"]);
  assert.deepEqual(lv(run(null, { NIGHTLY_SCHEDULE: "3.30pm" }), "nightly-schedule"), ["warn"]);
  assert.deepEqual(lv(run(null, { NIGHTLY_SCHEDULE: "03:30", BOXING_PROVIDER: "demo" }), "nightly-schedule"), ["info"]);
});
