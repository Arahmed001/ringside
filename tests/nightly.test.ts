import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { verifyBackup } from "../lib/backup";
import { EXIT_LOCKED, EXIT_REFUSED, EXIT_VENDOR } from "../lib/vendor-backfill";
import { NightlyLockHeld, acquireNightlyLock, configFromEnv, lockFile, redact, releaseNightlyLock, runNightly, LOCK_STALE_MS } from "../lib/nightly";
import { EXIT_MEANING, exitMeaning } from "../lib/nightly-status";
import { KEY, ROOT, alive, makeLeague, makeTemplate, makeVolume, nap, readStatusFile, serveFaulty, stampDirs, startNightly, tmp, until, type Volume } from "./nightly-helpers";
import { nextDay, results, state, start as startBackfill, UPDATE } from "./update-failures-helpers";

/**
 * The in-container nightly job (lib/nightly.ts, scripts/nightly.ts): the real script against a volume in a temp folder and the stand-in vendor. The decision
 * these tests pin: the backup is taken ALWAYS, and BEFORE the update, because the update is the only step that changes the data; the update then runs even if
 * the backup failed (a stale site is the worse risk), and an off-host copy that fails is reported and never touches the update.
 */
const work = tmp("nightly");
let tpl = "", baseline: ReturnType<typeof state>;
before(async () => { tpl = await makeTemplate(work); baseline = state(tpl); });
after(() => fs.rmSync(work, { recursive: true, force: true }));

const OLD = ["2020-01-01T03-00-00Z", "2020-01-02T03-00-00Z", "2020-01-03T03-00-00Z", "2020-01-04T03-00-00Z", "2020-01-05T03-00-00Z"];
const stepsOf = (v: Volume) => Object.fromEntries(readStatusFile(v).steps.map((s) => [s.name, s]));
const secretFree = (v: Volume, out: string) => { assert.ok(!out.includes(KEY), "the key is never printed"); assert.ok(!fs.readFileSync(v.status, "utf8").includes(KEY), "nor written to the status file"); };

test("a healthy night: backup verified, update applied, old backups pruned to N, nothing that is not a backup touched, status written", async () => {
  const v = makeVolume(tpl, "happy", { oldBackups: OLD, extras: true });
  const vendor = await serveFaulty(nextDay(makeLeague()).world);
  const r = await startNightly(v, { url: vendor.url, env: { NIGHTLY_KEEP: "3" } }).wait();
  await vendor.close();
  assert.equal(r.code, 0, r.out);
  const st = readStatusFile(v), steps = stepsOf(v);
  assert.equal(st.result, "ok");
  assert.deepEqual([st.exitCode, steps.backup.exitCode, steps.update.exitCode, steps.offsite.exitCode, steps.offsite.skipped], [0, 0, 0, null, true]);
  assert.ok(st.finished && st.started <= st.finished);
  assert.equal(st.next, null, "no schedule is set: nobody is waiting for a next run");
  assert.match(steps.update.message, /^applied: .*events/, "the update's own summary line is kept");
  // the update was applied: a new run is on record, and the card of the evening is in
  const after = state(v.db);
  assert.equal(after.runs, baseline.runs + 1);
  assert.equal(results(v.db).has("bda-b-n1"), true);
  // the backup was taken before the update: it holds the database as it was
  const folders = stampDirs(v);
  assert.equal(folders.length, 3, "the newest 3 are kept: the 4 oldest are gone");
  assert.deepEqual(folders.slice(0, 2), OLD.slice(3), "the oldest of the old ones went first");
  const fresh = path.join(v.backups, folders[2]);
  assert.deepEqual(verifyBackup(fresh, { requireChecksums: true }), []);
  assert.ok(fs.existsSync(path.join(fresh, "accounts.db")), "both databases are in it");
  assert.equal(fs.statSync(path.join(fresh, "accounts.db")).mode & 0o077, 0, "the accounts copy is private, like the original");
  assert.equal(state(path.join(fresh, "ringside.db")).hash, baseline.hash, "the copy is the database from before the update");
  // what is not a backup this tool made is still there
  assert.ok(fs.existsSync(path.join(v.backups, "before-restore", "2019-01-01T00-00-00Z", "ringside.db")), "the safety copies of a restore are never pruned");
  assert.ok(fs.existsSync(path.join(v.backups, "my-handmade-copy", "ringside.db")) && fs.existsSync(path.join(v.backups, "notes.txt")));
  // one clear line per step, none with the key
  for (const n of ["backup", "update"]) assert.equal(r.out.split("\n").filter((l) => l.startsWith(`[nightly] step=${n} `)).length, 1, n);
  assert.match(r.out, /\[nightly\] step=offsite skipped/);
  secretFree(v, r.out);
  assert.ok(!fs.existsSync(path.join(v.lockDir, "ringside-nightly.lock")), "the lock is given back");
});

test("the vendor is down: exit 2, the backup was still taken first, the data is as it was, the failure is recorded", async () => {
  const v = makeVolume(tpl, "down", { oldBackups: OLD.slice(0, 1) });
  const dead = await serveFaulty(nextDay(makeLeague()).world, { fault: () => ({ status: 503, body: { error: "unavailable" } }) });
  const r = await startNightly(v, { url: dead.url }).wait();
  await dead.close();
  assert.equal(r.code, EXIT_VENDOR, r.out);
  const st = readStatusFile(v), steps = stepsOf(v);
  assert.equal(st.result, "failed");
  assert.deepEqual([st.exitCode, steps.backup.ok, steps.update.exitCode, steps.update.ok], [2, true, 2, false]);
  assert.match(st.exitMeaning, /vendor is unreachable/);
  assert.equal(stampDirs(v).length, 2, "the backup is taken on a night the update fails too");
  assert.equal(state(v.db).hash, baseline.hash, "the site keeps its old data");
  assert.equal(state(v.db).runs, baseline.runs, "no update run is recorded, so freshness (and the 48 h stale alert) keeps counting from the last good one");
  assert.match(r.out, /\[nightly\] step=update FAILED exit=2/);
  secretFree(v, r.out);
});

test("the vendor sends something that is not an answer: exit 3 passes through, nothing is written", async () => {
  const v = makeVolume(tpl, "rubbish");
  const bad = await serveFaulty(nextDay(makeLeague()).world, { fault: () => ({ raw: "<html>maintenance</html>" }) });
  const r = await startNightly(v, { url: bad.url }).wait();
  await bad.close();
  assert.equal(r.code, EXIT_REFUSED, r.out);
  assert.equal(readStatusFile(v).result, "failed");
  assert.equal(state(v.db).hash, baseline.hash);
});

test("the update's exit codes are the ones PLAN 224 gave, and the status says what each means", () => {
  assert.deepEqual([EXIT_VENDOR, EXIT_REFUSED, EXIT_LOCKED], [2, 3, 75]);
  for (const c of [0, 1, EXIT_VENDOR, EXIT_REFUSED, EXIT_LOCKED, 130]) assert.ok(EXIT_MEANING[c], `a meaning for ${c}`);
  assert.equal(exitMeaning(137), "killed by signal 9");
  assert.equal(exitMeaning(null), "not run");
});

test("a nightly job already running: the second stops with 75 and changes nothing (no backup, no status file)", async () => {
  const v = makeVolume(tpl, "locked");
  fs.mkdirSync(v.lockDir, { recursive: true });
  fs.writeFileSync(lockFile(v.lockDir), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); // this very test process: alive
  const r = await startNightly(v).wait();
  assert.equal(r.code, 75, r.out);
  assert.match(r.out, /Another nightly job is already running/);
  assert.equal(stampDirs(v).length, 0);
  assert.ok(!fs.existsSync(v.status), "the running job owns the status file");
  assert.ok(fs.existsSync(lockFile(v.lockDir)), "and the holder's lock is not removed by the one that was refused");
});

test("a hand-run update holds the key's lock: the nightly's update stops with 75, after its backup, and the hand run is not disturbed", async () => {
  const v = makeVolume(tpl, "manual");
  const slow = await serveFaulty(nextDay(makeLeague()).world, { fault: () => ({ hang: true }) });
  const other = path.join(v.dir, "other.db"); fs.copyFileSync(tpl, other);
  const manual = startBackfill(UPDATE, { db: other, url: slow.url, lockDir: v.lockDir });
  try {
    await until(() => fs.existsSync(v.lockDir) && fs.readdirSync(v.lockDir).some((n) => n.startsWith("ringside-backfill-")), 30_000, "the manual run's lock");
    const r = await startNightly(v, { url: slow.url }).wait();
    assert.equal(r.code, EXIT_LOCKED, r.out);
    const steps = stepsOf(v);
    assert.deepEqual([steps.backup.ok, steps.update.exitCode], [true, 75]);
    assert.equal(stampDirs(v).length, 1);
    assert.equal(manual.child.exitCode, null, "the manual run is still going");
  } finally { manual.child.kill("SIGKILL"); await manual.wait(); await slow.close(); }
});

test("the lock: exclusive, taken over when its process is gone or it is very old, given back only by its owner", () => {
  const dir = tmp("lock");
  const a = acquireNightlyLock({ dir, pid: 11 as number, alive: () => true });
  assert.throws(() => acquireNightlyLock({ dir, pid: 12, alive: () => true }), NightlyLockHeld);
  assert.doesNotThrow(() => acquireNightlyLock({ dir, pid: 13, alive: (p) => p !== 11 }), "its process is gone");
  releaseNightlyLock(a, 11); // not the owner any more
  assert.ok(fs.existsSync(a));
  releaseNightlyLock(a, 13);
  assert.ok(!fs.existsSync(a));
  acquireNightlyLock({ dir, pid: 21, alive: () => true, now: () => new Date("2026-10-07T00:00:00Z") });
  assert.doesNotThrow(() => acquireNightlyLock({ dir, pid: 22, alive: () => true, now: () => new Date(Date.parse("2026-10-07T00:00:00Z") + LOCK_STALE_MS + 1000) }), "older than any run can last: a pid a restarted container reused");
  fs.writeFileSync(lockFile(dir), "{not json");
  assert.doesNotThrow(() => acquireNightlyLock({ dir, pid: 23, alive: () => true }), "an unreadable lock is stale");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- the off-host copy ----

const withOffsite = async (tag: string, cmd: string, extra: Record<string, string> = {}) => {
  const v = makeVolume(tpl, tag);
  const vendor = await serveFaulty(nextDay(makeLeague()).world);
  const r = await startNightly(v, { url: vendor.url, env: { NIGHTLY_OFFSITE_CMD: cmd, ...extra } }).wait();
  await vendor.close();
  return { v, r };
};

test("an off-host command that works is given the new backup folder as its argument, and not the keys", async () => {
  const marker = path.join(work, "offsite-ok.txt");
  const { v, r } = await withOffsite("off-ok", `sh -c 'printf "%s|%s|%s" "$1" "\${BOXING_API_KEY-unset}" "\${ANTHROPIC_API_KEY-unset}" > ${marker}; test -f "$1/ringside.db"' x`);
  assert.equal(r.code, 0, r.out);
  const [folder, key, ai] = fs.readFileSync(marker, "utf8").split("|");
  assert.equal(folder, path.join(v.backups, stampDirs(v)[0]));
  assert.deepEqual([key, ai], ["unset", "unset"], "the vendor's key and the AI key are not handed to a command that has no use for them");
  const off = stepsOf(v).offsite;
  assert.deepEqual([off.ok, off.exitCode, readStatusFile(v).result], [true, 0, "ok"]);
});

test("an off-host command that fails is reported (a warning) and the update stands", async () => {
  const { v, r } = await withOffsite("off-fail", "echo the-remote-said-no >&2; exit 7");
  assert.equal(r.code, 0, "the job's own work is done: a failed copy does not fail the night");
  const st = readStatusFile(v), off = stepsOf(v).offsite;
  assert.deepEqual([st.result, off.ok, off.exitCode, stepsOf(v).update.exitCode], ["warning", false, 7, 0]);
  assert.match(off.message, /exit 7.*update was not affected/);
  assert.ok(!off.message.includes("the-remote-said-no"), "the command's own words stay in the log, not in the status file");
  assert.match(r.out, /offsite: the-remote-said-no/);
  assert.equal(results(v.db).has("bda-b-n1"), true);
});

test("an off-host command that hangs is stopped at its timeout, with whatever it started, and the job still ends", async () => {
  const pidFile = path.join(work, "hang.pid");
  const { v, r } = await withOffsite("off-hang", `sh -c 'sleep 60 & echo $! > ${pidFile}; wait' x`, { NIGHTLY_OFFSITE_TIMEOUT_MIN: "0.04" });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.ms < 45_000, `took ${r.ms} ms`);
  const off = stepsOf(v).offsite;
  assert.deepEqual([off.ok, off.exitCode, readStatusFile(v).result], [false, 124, "warning"]);
  assert.match(off.message, /timed out/);
  await until(() => !alive(Number(fs.readFileSync(pidFile, "utf8"))), 5000, "the helper the command started to be gone");
});

test("no verified backup, no copy: a command is never handed a folder that failed its checks", async () => {
  const marker = path.join(work, "offsite-never.txt");
  const v = makeVolume(null, "nodb"); // no sports database at all: the backup cannot be made
  const r = await startNightly(v, { env: { NIGHTLY_OFFSITE_CMD: `touch ${marker}` } }).wait();
  assert.ok(!fs.existsSync(marker));
  const steps = stepsOf(v);
  assert.deepEqual([steps.backup.ok, steps.offsite.skipped, steps.offsite.ok], [false, true, false]);
  assert.equal(r.code, 1, "the update could not reach its vendor either (port 9); the backup's failure alone is also 1");
});

// ---- the pieces, in-process, with a stand-in for the update command ----

const node = (code: string) => ({ file: process.execPath, args: ["-e", code] });
async function inProcess(tag: string, o: { code: string; env?: Record<string, string>; settings?: Record<string, string>; timeout?: number; signal?: AbortSignal; sample?: number; noKey?: boolean }) {
  const v = makeVolume(tpl, tag);
  const lines: string[] = [];
  const out = await runNightly({
    env: { DATABASE_PATH: v.db, ACCOUNTS_DB_PATH: v.accounts, RINGSIDE_LOCK_DIR: v.lockDir, PATH: process.env.PATH, ...(o.noKey ? {} : { BOXING_API_KEY: KEY }), ...o.env }, settings: o.settings ?? {},
    log: (l) => lines.push(l), updateCommand: node(o.code), updateTimeoutMs: o.timeout, signal: o.signal, sampleMs: o.sample, root: ROOT,
  });
  return { v, out, lines, text: lines.join("\n") };
}

test("the update runs as a child with its own memory settings, the environment as given, and the key never reaches the log", async () => {
  const r = await inProcess("child", { code: `console.log(JSON.stringify([process.env.NODE_OPTIONS, process.env.MALLOC_ARENA_MAX, process.env.BOXING_API_STORAGE_CONFIRMED])); console.log("my key is " + process.env.BOXING_API_KEY)`, env: { BOXING_API_STORAGE_CONFIRMED: "1", NODE_OPTIONS: "--max-old-space-size=9999" } });
  assert.equal(r.out.exitCode, 0);
  assert.match(r.text, /\["--max-old-space-size=768","2","1"\]/, "the site's own NODE_OPTIONS is not inherited; the defaults are 768 MB of heap and two malloc arenas");
  assert.ok(!r.text.includes(KEY));
  assert.match(r.text, /my key is \[key\]/);
  const custom = await inProcess("child2", { code: `console.log(process.env.NODE_OPTIONS + "|" + process.env.MALLOC_ARENA_MAX)`, settings: { NIGHTLY_NODE_OPTIONS: "--max-old-space-size=1024" }, env: { MALLOC_ARENA_MAX: "4" } });
  assert.match(custom.text, /--max-old-space-size=1024\|4/, "both can be set");
});

test("the child's memory is made visible: the peak is logged and kept in the status file (Linux)", { skip: !fs.existsSync("/proc/self/status") }, async () => {
  const r = await inProcess("mem", { code: `const a = Buffer.alloc(80 * 1024 * 1024, 1); setTimeout(() => console.log(a.length), 1500)`, sample: 100 });
  const upd = r.out.status!.steps.find((s) => s.name === "update")!;
  assert.ok(upd.peakMemoryMb! >= 80, `peak ${upd.peakMemoryMb}`);
  assert.match(r.text, /update peak memory about \d+ MB/);
});

test("an update that runs too long is stopped, recorded, and the lock is given back", async () => {
  const r = await inProcess("timeout", { code: `setTimeout(() => {}, 60000)`, timeout: 600 });
  assert.equal(r.out.exitCode, 1);
  assert.match(r.out.status!.steps.find((s) => s.name === "update")!.message, /^stopped: still running/);
  assert.ok(!fs.existsSync(lockFile(r.v.lockDir)));
});

test("a missing key is a recorded failure, not a crash: the backup is still taken", async () => {
  const v = makeVolume(tpl, "nokey");
  const r = await startNightly(v, { noKey: true }).wait();
  assert.equal(r.code, 1, r.out);
  const steps = stepsOf(v);
  assert.deepEqual([steps.backup.ok, steps.update.ok, steps.update.exitCode], [true, false, 1]);
  assert.match(steps.update.message, /BOXING_API_KEY is not set/);
  assert.equal(stampDirs(v).length, 1);
});

test("a backup that cannot be made does not stop the update, and is exit 1 when the update went well", async () => {
  const lines: string[] = [];
  const dir = tmp("nobackup");
  const out = await runNightly({ env: { DATABASE_PATH: path.join(dir, "missing.db"), RINGSIDE_LOCK_DIR: path.join(dir, "l"), BOXING_API_KEY: KEY }, settings: {}, log: (l) => lines.push(l), updateCommand: node(`console.log("fine")`) });
  assert.equal(out.exitCode, 1);
  const s = Object.fromEntries(out.status!.steps.map((x) => [x.name, x]));
  assert.deepEqual([s.backup.ok, s.update.ok, out.status!.result], [false, true, "failed"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SIGTERM during the update: the update is stopped, the run is recorded as interrupted (130), the lock is given back, and the offsite step does not start", async () => {
  const v = makeVolume(tpl, "sigterm");
  const slow = await serveFaulty(nextDay(makeLeague()).world, { fault: () => ({ hang: true }) });
  const marker = path.join(work, "offsite-after-term.txt");
  const run = startNightly(v, { url: slow.url, env: { NIGHTLY_OFFSITE_CMD: `touch ${marker}` } });
  try {
    await until(() => slow.log.length > 0, 60_000, "the update to reach the vendor");
    run.child.kill("SIGTERM");
    const r = await run.wait();
    assert.equal(r.code, 130, r.out);
    const st = readStatusFile(v);
    assert.deepEqual([st.result, st.exitCode, stepsOf(v).update.exitCode], ["interrupted", 130, 130]);
    assert.ok(!fs.existsSync(marker));
    assert.ok(!fs.existsSync(lockFile(v.lockDir)));
    assert.deepEqual(fs.readdirSync(v.lockDir).filter((n) => n.startsWith("ringside-backfill-")), [], "the update gave its own key lock back");
    assert.equal(state(v.db).hash, baseline.hash);
  } finally { run.child.kill("SIGKILL"); await slow.close(); }
});

test("settings: unusable values are ignored with a warning, the defaults hold", () => {
  const c = configFromEnv({});
  assert.deepEqual([c.keep, c.offsiteCmd, c.childNodeOptions, c.schedule, c.warnings.length], [7, null, "--max-old-space-size=768", null, 0]);
  const bad = configFromEnv({ NIGHTLY_KEEP: "0", NIGHTLY_OFFSITE_TIMEOUT_MIN: "-1", NIGHTLY_SCHEDULE: "25:00" });
  assert.equal(bad.keep, 7); assert.equal(bad.schedule, null); assert.equal(bad.warnings.length, 3);
  const good = configFromEnv({ NIGHTLY_KEEP: "14", NIGHTLY_SCHEDULE: "03:30", NIGHTLY_OFFSITE_CMD: " rclone copy ", NIGHTLY_OFFSITE_TIMEOUT_MIN: "5" });
  assert.deepEqual([good.keep, good.schedule, good.offsiteCmd, good.offsiteTimeoutMs], [14, { hour: 3, minute: 30 }, "rclone copy", 300_000]);
  assert.equal(redact("a SECRETSECRET b", ["SECRETSECRET", undefined, "short"]), "a [key] b");
});

test("a status file whose run was cut off is not mistaken for a finished one, and the next run replaces it", async () => {
  const v = makeVolume(tpl, "cutoff");
  fs.writeFileSync(v.status, JSON.stringify({ version: 1, started: "2020-01-01T00:00:00.000Z", finished: null, result: "running", exitCode: null, exitMeaning: "running", steps: [], next: null }));
  const r = await runNightly({ env: { DATABASE_PATH: v.db, ACCOUNTS_DB_PATH: v.accounts, RINGSIDE_LOCK_DIR: v.lockDir, BOXING_API_KEY: KEY }, settings: { NIGHTLY_SCHEDULE: "03:30" }, log: () => {}, updateCommand: node(`0`) });
  assert.equal(r.exitCode, 0);
  const st = readStatusFile(v);
  assert.equal(st.result, "ok");
  assert.ok(st.next && Date.parse(st.next) > Date.parse(st.finished!), "the next scheduled time is recorded");
  assert.match(st.next!, /T03:30:00\.000Z$/);
  await nap(0);
});
