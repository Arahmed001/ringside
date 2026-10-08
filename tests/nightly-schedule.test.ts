import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { START_DELAY_MS, createScheduler, jitterMinutes, jitterMs, type SchedulerDeps } from "../lib/nightly-schedule";
import { nextSlot, parseSchedule, type NightlyStatus } from "../lib/nightly-status";
import { ROOT, alive, nap, tmp, until } from "./nightly-helpers";

/**
 * The optional scheduler (lib/nightly-schedule.ts): the clock, the timer, the random numbers and the job are all injected, so a day passes in a loop.
 * Plus the real scheduler process and the container entrypoint (scripts/docker-entrypoint.sh) with a stand-in for `npm start`.
 */
const T = (iso: string) => new Date(`2026-10-07T${iso}Z`);
const minute = 60_000;
const status = (started: string): NightlyStatus => ({ version: 1, started, finished: started, result: "ok", exitCode: 0, exitMeaning: "done", steps: [], next: null });

/** A scheduler on a fake clock; `runs` lists the times the job was started. The job takes `jobMs` and, like the real one, leaves a status file saying when it began. */
function rig(o: { at: string; schedule?: string; jitterMin?: number; random?: number; last?: NightlyStatus | null; jobMs?: number; startDelayMs?: number }) {
  let t = T(o.at).getTime();
  let last = o.last ?? null;
  const runs: string[] = [], logs: string[] = [];
  const pending: (() => void)[] = [];
  const deps: SchedulerDeps = {
    schedule: parseSchedule(o.schedule ?? "03:00")!, jitterMin: o.jitterMin ?? 0, now: () => new Date(t), random: () => o.random ?? 0, log: (l) => logs.push(l),
    readStatus: () => last, startDelayMs: o.startDelayMs,
    runJob: () => { const began = new Date(t); runs.push(began.toISOString()); last = status(began.toISOString()); return new Promise((ok) => { if (!o.jobMs) ok(0); else pending.push(() => ok(0)); }); },
  };
  const s = createScheduler(deps);
  return {
    s, runs, logs, deps,
    /** moves the clock forward and ticks every 30 s on the way, as the interval would */
    async advance(ms: number) { const end = t + ms; while (t < end) { t = Math.min(end, t + 30_000); await s.tick(); } },
    finishJob() { pending.shift()?.(); },
    setLast(l: NightlyStatus | null) { last = l; },
  };
}

test("the schedule text: HH:MM in 24 hours, nothing else; the next slot is strictly after now", () => {
  assert.deepEqual(parseSchedule("03:30"), { hour: 3, minute: 30 });
  assert.deepEqual(parseSchedule(" 23:59 "), { hour: 23, minute: 59 });
  for (const bad of [undefined, "", "3:30", "24:00", "12:60", "03:30:00", "0330", "noon", "03.30"]) assert.equal(parseSchedule(bad), null, String(bad));
  const s = { hour: 3, minute: 30 };
  assert.equal(nextSlot(T("03:00:00"), s).toISOString(), "2026-10-07T03:30:00.000Z");
  assert.equal(nextSlot(T("03:30:00"), s).toISOString(), "2026-10-08T03:30:00.000Z", "at the slot itself the next one is tomorrow's");
  assert.equal(nextSlot(new Date("2026-12-31T23:00:00Z"), s).toISOString(), "2027-01-01T03:30:00.000Z");
});

test("jitter: from 0 up to the number of minutes asked, never beyond, whatever the random source says", () => {
  assert.equal(jitterMs(5, () => 0), 0);
  assert.equal(jitterMs(5, () => 0.5), 150_000);
  assert.ok(jitterMs(5, () => 0.9999999) < 5 * minute);
  assert.ok(jitterMs(5, () => 1) < 5 * minute && jitterMs(5, () => 2) < 5 * minute);
  assert.equal(jitterMs(5, () => -1), 0);
  assert.equal(jitterMs(0, () => 0.7), 0, "jitter off");
  for (let i = 0; i < 1000; i++) { const j = jitterMs(5, Math.random); assert.ok(j >= 0 && j < 5 * minute); }
  assert.deepEqual([undefined, "", "0", "2.5", "60", "61", "-1", "x"].map(jitterMinutes), [5, 5, 0, 2.5, 60, 5, 5, 5]);
});

test("the job starts once, at the slot, on a day that began before it; later ticks the same day do nothing", async () => {
  const r = rig({ at: "02:00:00" });
  await r.advance(59 * minute + 30_000);
  assert.equal(r.runs.length, 0, "02:59:30 is early");
  await r.advance(60_000);
  assert.deepEqual(r.runs, ["2026-10-07T03:00:00.000Z"]);
  await r.advance(20 * 3_600_000);
  assert.equal(r.runs.length, 1, "not again for the rest of the day");
  await r.advance(5 * 3_600_000);
  assert.deepEqual(r.runs.map((x) => x.slice(0, 16)), ["2026-10-07T03:00", "2026-10-08T03:00"], "and again the next day");
});

test("the jitter delays the start by the random amount, chosen once for the day and logged", async () => {
  const r = rig({ at: "02:50:00", jitterMin: 4, random: 0.5 });
  await r.advance(10 * minute + 90_000);
  assert.deepEqual(r.runs, [], "03:01:30 is before 03:02");
  await r.advance(60_000);
  assert.equal(r.runs.length, 1);
  assert.ok(Date.parse(r.runs[0]) - Date.parse("2026-10-07T03:00:00Z") === 2 * minute, r.runs[0]);
  assert.equal(r.logs.filter((l) => /plus 120 s of jitter/.test(l)).length, 1);
});

test("a restart after the job began does not run it again that day (the status file decides, not memory), and the next day it does", async () => {
  const r = rig({ at: "02:00:00" });
  await r.advance(2 * 3_600_000);
  assert.equal(r.runs.length, 1);
  // the container restarts at 03:40: a new scheduler, the same status file
  const again = rig({ at: "03:40:00", last: status(r.runs[0]) });
  await again.advance(10 * 3_600_000);
  assert.deepEqual(again.runs, [], "the job began at 03:00: nothing more today");
  await again.advance(14 * 3_600_000); // through tomorrow's 03:00
  assert.equal(again.runs.length, 1);
  assert.match(again.runs[0], /^2026-10-08T03:/);
});

test("a run that began and failed counts as today's run; so does a hand run after the slot", async () => {
  const failed = { ...status("2026-10-07T03:00:20.000Z"), result: "failed" as const, exitCode: 2 };
  const a = rig({ at: "05:00:00", last: failed });
  await a.advance(2 * 3_600_000);
  assert.deepEqual(a.runs, [], "no retry storm after a vendor failure; the stale alert and a hand run are for that");
  const b = rig({ at: "08:00:00", last: status("2026-10-07T07:45:00.000Z") });
  await b.advance(3_600_000);
  assert.deepEqual(b.runs, []);
});

test("a container that was down at the slot catches the day's run up after a grace period, not at once", async () => {
  const r = rig({ at: "09:00:00", last: status("2026-10-06T03:00:10.000Z") });
  await r.advance(START_DELAY_MS - 60_000);
  assert.deepEqual(r.runs, [], "the site is still building its world");
  await r.advance(2 * minute);
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0], "2026-10-07T09:10:00.000Z");
  const early = rig({ at: "01:00:00", last: status("2026-10-05T03:00:00.000Z") });
  await early.advance(60 * minute);
  assert.deepEqual(early.runs, [], "before today's slot there is nothing to catch up: yesterday's missed run is not chased at 01:00");
});

test("no status file at all counts as never run; an unreadable one reads as none", async () => {
  const r = rig({ at: "03:00:00", last: null });
  await r.advance(START_DELAY_MS + minute);
  assert.equal(r.runs.length, 1);
});

test("a job still running is not started a second time, and the scheduler waits for it", async () => {
  const r = rig({ at: "03:00:00", jobMs: 1, startDelayMs: 0 });
  const first = r.s.tick(); // starts the job, which does not end until told to
  assert.equal(r.s.running, true);
  assert.equal(await r.s.tick(), "busy");
  assert.equal(await r.s.tick(), "busy");
  assert.equal(r.runs.length, 1);
  r.finishJob();
  assert.equal(await first, "ran");
  assert.equal(r.s.running, false);
  assert.equal(await r.s.tick(), "waiting", "and it began today, so that is that");
});

test("the timer: start() asks for a tick every half minute and stop() cancels it and stops the job from starting", async () => {
  const calls: { f: () => void; ms: number }[] = [], cleared: unknown[] = [];
  const r = rig({ at: "03:00:00" });
  const s = createScheduler({ ...r.deps, now: () => T("12:00:00"), setInterval: (f, ms) => { calls.push({ f, ms }); return "handle"; }, clearInterval: (h) => cleared.push(h) });
  s.start();
  assert.deepEqual(calls.map((c) => c.ms), [30_000]);
  s.stop();
  assert.deepEqual(cleared, ["handle"]);
  assert.equal(await s.tick(), "busy", "a stopped scheduler starts nothing");
  assert.equal(r.runs.length, 0);
});

test("a job that cannot be started is logged, and the scheduler carries on", async () => {
  const logs: string[] = [];
  const s = createScheduler({ schedule: { hour: 3, minute: 0 }, jitterMin: 0, now: () => T("03:30:00"), random: () => 0, log: (l) => logs.push(l), readStatus: () => null, runJob: async () => { throw new Error("spawn failed"); }, startDelayMs: 0 });
  assert.equal(await s.tick(), "ran");
  assert.ok(logs.some((l) => /could not run the nightly job: spawn failed/.test(l)));
  assert.equal(s.running, false);
});

// ---- the real processes ----

const env = (dir: string, extra: Record<string, string | undefined> = {}) => {
  const e = { ...process.env, DATABASE_PATH: path.join(dir, "ringside.db"), RINGSIDE_LOCK_DIR: path.join(dir, "locks"), ...extra } as Record<string, string | undefined>;
  delete e.BOXING_API_KEY; delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e as NodeJS.ProcessEnv;
};
function launch(cmd: string, args: string[], e: NodeJS.ProcessEnv) {
  const child = spawn(cmd, args, { cwd: ROOT, env: e, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout!.on("data", (d) => (out += d)); child.stderr!.on("data", (d) => (out += d));
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((ok) => child.on("close", (code, signal) => ok({ code, signal })));
  return { child, done, output: () => out };
}

test("the scheduler process: stays quiet until the time, and SIGTERM ends it cleanly and quickly", async () => {
  const dir = tmp("sched");
  const p = launch(process.execPath, ["--import", "tsx", "scripts/nightly-scheduler.ts"], env(dir, { NIGHTLY_SCHEDULE: "03:00" }));
  await until(() => /\[nightly-scheduler\] on: every day at 03:00 UTC/.test(p.output()), 30_000, "the scheduler to say it is on");
  const t0 = Date.now();
  p.child.kill("SIGTERM");
  const r = await p.done;
  assert.deepEqual([r.code, r.signal], [0, null], p.output());
  assert.ok(Date.now() - t0 < 5000);
  assert.match(p.output(), /SIGTERM: stopping/);
  assert.ok(!fs.existsSync(path.join(dir, "nightly-status.json")), "it started nothing");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a bad NIGHTLY_SCHEDULE leaves the scheduler off, and says so, without failing", async () => {
  const dir = tmp("sched-bad");
  const r = await launch(process.execPath, ["--import", "tsx", "scripts/nightly-scheduler.ts"], env(dir, { NIGHTLY_SCHEDULE: "3am" })).done;
  assert.equal(r.code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for `npm`: `npm start` prints a line, then idles until told to stop. */
function fakeNpm(dir: string): string {
  const bin = path.join(dir, "bin"); fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\necho "fake site up: $*"\ntrap 'echo "fake site got TERM"; exit 0' TERM INT\nwhile true; do sleep 0.1; done\n`, { mode: 0o755 });
  return bin;
}

test("the entrypoint without NIGHTLY_SCHEDULE is exactly `npm start`", async () => {
  const dir = tmp("entry-off"), bin = fakeNpm(dir);
  const p = launch("sh", ["scripts/docker-entrypoint.sh"], env(dir, { PATH: `${bin}:${process.env.PATH}`, NIGHTLY_SCHEDULE: undefined }));
  await until(() => p.output().includes("fake site up: start"), 10_000, "the site to start");
  await nap(300);
  assert.ok(!p.output().includes("nightly-scheduler"), "no scheduler");
  p.child.kill("SIGTERM");
  assert.equal((await p.done).code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the entrypoint with NIGHTLY_SCHEDULE starts the scheduler beside the site, passes a stop signal to both, and ends with the site's exit code", async () => {
  const dir = tmp("entry-on"), bin = fakeNpm(dir);
  const p = launch("sh", ["scripts/docker-entrypoint.sh"], env(dir, { PATH: `${bin}:${process.env.PATH}`, NIGHTLY_SCHEDULE: "03:00" }));
  await until(() => p.output().includes("fake site up: start") && p.output().includes("[nightly-scheduler] on:"), 30_000, "both to start");
  p.child.kill("SIGTERM");
  const r = await p.done;
  assert.equal(r.code, 0, p.output());
  assert.match(p.output(), /fake site got TERM/);
  assert.match(p.output(), /\[nightly-scheduler\] SIGTERM: stopping/);
  assert.ok(!alive(p.child.pid!));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the entrypoint script is valid shell", () => {
  const sh = spawnSync("sh", ["-n", "scripts/docker-entrypoint.sh"], { cwd: ROOT });
  assert.equal(sh.status, 0, String(sh.stderr));
});
