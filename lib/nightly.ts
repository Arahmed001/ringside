import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupDatabases, pruneBackups, verifyBackup } from "./backup";
import {
  exitMeaning, nextSlot, parseSchedule, publicNightly, statusPath, writeStatus,
  type NightlyEnv, type NightlyResult, type NightlyStatus, type StepName, type StepResult,
} from "./nightly-status";
import { isDue, parseWatchSources, type WatchPlan } from "./watch/schedule";

/**
 * The nightly job, run inside the one container that holds the data volume (docs/nightly.md). Three steps, under one lock:
 *   1. a verified backup of both databases (BEFORE the update: see below), keeping the newest NIGHTLY_KEEP;
 *   2. the daily update, the same `vendor:backfill -- --update --cache-dir <data>/vendor-cache` the runbook gives, run as a CHILD process so its memory is its own;
 *   3. optionally NIGHTLY_OFFSITE_CMD, given the folder of step 1, to copy the backup off the host. Its failure is reported, never fatal to anything.
 * Then `nightly-status.json` says what happened. Every step's outcome is recorded whatever the others did.
 *
 * Why the backup comes first and is always taken: an update is the only thing this job does that changes the data, so the copy that matters is the one from just
 * before it. Taking it only after a good update would leave no fresh copy on exactly the nights something is wrong with the vendor's data. The update is then told
 * `--no-backup` (it would only make a second, partial copy of the sports database into the same folder, and shorten the number of nights NIGHTLY_KEEP means).
 * The update still runs when the backup failed: it is one transaction and idempotent, and a stale site is the worse risk; the failure is recorded and exits 1.
 */
export const DEFAULT_KEEP = 7;
export const DEFAULT_CHILD_NODE_OPTIONS = "--max-old-space-size=768";
export const DEFAULT_MALLOC_ARENA_MAX = "2";
export const DEFAULT_OFFSITE_TIMEOUT_MIN = 30;
export const UPDATE_TIMEOUT_MS = 4 * 3_600_000;
/** one source's look: a few page fetches a second apart, so half an hour is far more than it needs */
export const WATCH_TIMEOUT_MS = 30 * 60_000;
export const NEWS_TIMEOUT_MS = 15 * 60_000;
/** A lock older than this belongs to a run that died (no run lasts so long); it also covers a pid that a restarted container has given to something else. */
export const LOCK_STALE_MS = 6 * 3_600_000;

type Env = Record<string, string | undefined>;
const ROOT = path.resolve(__dirname, "..");

export interface NightlyConfig { keep: number; offsiteCmd: string | null; offsiteTimeoutMs: number; childNodeOptions: string; schedule: { hour: number; minute: number } | null; updateArgs: string[]; watch: WatchPlan; news: boolean; warnings: string[] }
/** Reads the settings. A value that is not usable is ignored with a warning (the job never refuses to run for a typo in an option). */
export function configFromEnv(s: Partial<NightlyEnv>): NightlyConfig {
  const warnings: string[] = [];
  let keep = DEFAULT_KEEP;
  if (s.NIGHTLY_KEEP !== undefined && s.NIGHTLY_KEEP.trim() !== "") {
    const n = Number(s.NIGHTLY_KEEP);
    if (Number.isInteger(n) && n >= 1 && n <= 365) keep = n; else warnings.push(`NIGHTLY_KEEP="${s.NIGHTLY_KEEP}" is not a whole number from 1 to 365: keeping ${DEFAULT_KEEP}.`);
  }
  let min = DEFAULT_OFFSITE_TIMEOUT_MIN;
  if (s.NIGHTLY_OFFSITE_TIMEOUT_MIN !== undefined && s.NIGHTLY_OFFSITE_TIMEOUT_MIN.trim() !== "") {
    const n = Number(s.NIGHTLY_OFFSITE_TIMEOUT_MIN);
    if (n > 0 && n <= 24 * 60) min = n; else warnings.push(`NIGHTLY_OFFSITE_TIMEOUT_MIN="${s.NIGHTLY_OFFSITE_TIMEOUT_MIN}" is not a number of minutes above 0: using ${DEFAULT_OFFSITE_TIMEOUT_MIN}.`);
  }
  const schedule = parseSchedule(s.NIGHTLY_SCHEDULE);
  if (s.NIGHTLY_SCHEDULE?.trim() && !schedule) warnings.push(`NIGHTLY_SCHEDULE="${s.NIGHTLY_SCHEDULE}" is not HH:MM (UTC, 24 hours): the scheduler stays off.`);
  const watch = parseWatchSources(s.WATCH_SOURCES);
  warnings.push(...watch.warnings);
  const news = s.NEWS_REFRESH?.trim() === "1";
  return {
    keep, offsiteCmd: s.NIGHTLY_OFFSITE_CMD?.trim() || null, offsiteTimeoutMs: Math.round(min * 60_000),
    childNodeOptions: s.NIGHTLY_NODE_OPTIONS?.trim() || DEFAULT_CHILD_NODE_OPTIONS, schedule,
    updateArgs: (s.RINGSIDE_NIGHTLY_UPDATE_ARGS ?? "").split(/\s+/).filter(Boolean), watch, news, warnings,
  };
}

// ---- the lock ----

export class NightlyLockHeld extends Error {}
export interface LockOpts { dir: string; pid?: number; alive?: (pid: number) => boolean; now?: () => Date }
const processAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
export const lockFile = (dir: string) => path.join(dir, "ringside-nightly.lock");

/**
 * One nightly job at a time on this machine, and not beside a second copy of itself started by hand. The file is created exclusively, so two starting together
 * cannot both win. A lock whose process is gone, or that is older than LOCK_STALE_MS, is taken over. (A hand-run `vendor:backfill` is a different lock, the
 * per-key one: the update step meets it and stops with 75.) Returns the path to give back.
 */
export function acquireNightlyLock(o: LockOpts): string {
  const file = lockFile(o.dir), pid = o.pid ?? process.pid, alive = o.alive ?? processAlive, now = o.now ?? (() => new Date());
  fs.mkdirSync(o.dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, JSON.stringify({ pid, startedAt: now().toISOString() }), { flag: "wx" }); return file; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let held: { pid?: number; startedAt?: string } = {};
      try { held = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* unreadable: stale */ }
      const age = now().getTime() - Date.parse(held.startedAt ?? "");
      if (typeof held.pid === "number" && alive(held.pid) && Number.isFinite(age) && age < LOCK_STALE_MS)
        throw new NightlyLockHeld(`Another nightly job is already running (process ${held.pid}, started ${held.startedAt}).`);
      fs.rmSync(file, { force: true }); // stale: take it over
    }
  }
  throw new NightlyLockHeld("Another nightly job took the lock first.");
}
export function releaseNightlyLock(file: string, pid = process.pid): void {
  try { if ((JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number }).pid === pid) fs.rmSync(file, { force: true }); } catch { /* already gone */ }
}

// ---- child processes ----

/** Cuts the vendor key (and anything that looks like a long secret next to the word "key") out of a line before it is logged or stored. */
export function redact(line: string, secrets: (string | undefined)[]): string {
  let out = line;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[key]");
  return out;
}
const oneLine = (s: string, n = 200) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

function lineSplitter(onLine: (l: string) => void) {
  let buf = "";
  return {
    push(chunk: Buffer | string) { buf += chunk; let i; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, "")); buf = buf.slice(i + 1); } },
    end() { if (buf) onLine(buf); buf = ""; },
  };
}

/** The child's resident memory high-water mark in MB, read from /proc (Linux); undefined elsewhere or once it has gone. */
export function peakMemoryMb(pid: number): number | undefined {
  try { const m = /^VmHWM:\s+(\d+) kB/m.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8")); return m ? Math.round(Number(m[1]) / 1024) : undefined; } catch { return undefined; }
}

export interface ChildOutcome { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; tail: string[]; peakMb?: number; spawnError?: string }
export interface ChildSpec { file: string; args: string[]; env: Env; cwd: string; timeoutMs: number; signal?: AbortSignal; onLine: (l: string) => void; detached?: boolean; sampleMs?: number }

/** Runs a command to its end: streams its lines, samples its memory, stops it on timeout or abort (TERM, then KILL five seconds later, the whole process group when detached). */
export function runChild(spec: ChildSpec): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(spec.file, spec.args, { cwd: spec.cwd, env: spec.env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], detached: spec.detached }); }
    catch (e) { return resolve({ code: null, signal: null, timedOut: false, tail: [], spawnError: (e as Error).message }); }
    const tail: string[] = [];
    const out = lineSplitter((l) => { tail.push(l); if (tail.length > 30) tail.shift(); spec.onLine(l); });
    const err = lineSplitter((l) => { tail.push(l); if (tail.length > 30) tail.shift(); spec.onLine(l); });
    child.stdout!.on("data", (d) => out.push(d)); child.stderr!.on("data", (d) => err.push(d));
    let timedOut = false, peak: number | undefined, killer: NodeJS.Timeout | undefined;
    const send = (sig: NodeJS.Signals) => { try { if (spec.detached && child.pid) process.kill(-child.pid, sig); else child.kill(sig); } catch { /* gone already */ } };
    const stop = () => { send("SIGTERM"); killer ??= setTimeout(() => send("SIGKILL"), 5000); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, spec.timeoutMs);
    const onAbort = () => stop();
    if (spec.signal?.aborted) onAbort(); else spec.signal?.addEventListener("abort", onAbort, { once: true });
    const sampler = child.pid ? setInterval(() => { const m = peakMemoryMb(child.pid!); if (m !== undefined && (peak === undefined || m > peak)) peak = m; }, spec.sampleMs ?? 1000) : undefined;
    const done = (r: Omit<ChildOutcome, "tail" | "timedOut" | "peakMb">) => {
      clearTimeout(timer); if (killer) clearTimeout(killer); if (sampler) clearInterval(sampler); spec.signal?.removeEventListener("abort", onAbort);
      out.end(); err.end();
      if (spec.detached && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* nothing left */ } } // a command that left helpers behind does not keep the job alive
      resolve({ ...r, timedOut, tail, peakMb: peak });
    };
    child.on("error", (e) => done({ code: null, signal: null, spawnError: e.message }));
    child.on("close", (code, signal) => done({ code, signal }));
  });
}

const signalNumber = (s: NodeJS.Signals | null) => (s ? 128 + ((os.constants.signals as Record<string, number>)[s] ?? 0) : null);

// ---- the run ----

export interface NightlyOptions {
  /** the process environment: DATABASE_PATH, BOXING_API_KEY, BOXING_API_STORAGE_CONFIRMED and the rest are handed to the update as they are */
  env: Env;
  settings: Partial<NightlyEnv>;
  now?: () => Date;
  log?: (line: string) => void;
  lockDir?: string;
  signal?: AbortSignal;
  root?: string;
  /** tests: replace the update's command (default: node --import tsx scripts/vendor-backfill.ts --update ...) */
  updateCommand?: { file: string; args: string[] };
  updateTimeoutMs?: number;
  /** tests: replace the command that looks at one source (default: node --import tsx scripts/watch.ts --source <name> ...) */
  watchCommand?: (source: string) => { file: string; args: string[] };
  watchTimeoutMs?: number;
  /** tests: replace the command that refreshes the news (default: node --import tsx scripts/news-refresh.ts --database <db>) */
  newsCommand?: () => { file: string; args: string[] };
  newsTimeoutMs?: number;
  sampleMs?: number;
}
export interface NightlyOutcome { exitCode: number; status: NightlyStatus | null }

export async function runNightly(o: NightlyOptions): Promise<NightlyOutcome> {
  const now = o.now ?? (() => new Date());
  const cfg = configFromEnv(o.settings);
  const secrets = [o.env.BOXING_API_KEY?.trim(), o.env.ANTHROPIC_API_KEY?.trim(), o.env.YOUTUBE_API_KEY?.trim()];
  const say = (m: string) => (o.log ?? ((l: string) => console.log(l)))(`[nightly] ${redact(m, secrets)}`);
  const root = o.root ?? ROOT;
  const dbPath = o.env.DATABASE_PATH?.trim() || path.join(root, "data", "ringside.db");
  const dataDir = path.dirname(dbPath);
  const statusFile = statusPath({ DATABASE_PATH: dbPath });
  const lockDir = o.lockDir ?? o.env.RINGSIDE_LOCK_DIR ?? os.tmpdir();
  for (const w of cfg.warnings) say(`warning: ${w}`);

  let lock: string;
  try { lock = acquireNightlyLock({ dir: lockDir, now }); }
  catch (e) { if (e instanceof NightlyLockHeld) { say(`not started: ${e.message} Nothing was changed (exit 75).`); return { exitCode: 75, status: null }; } throw e; }

  const status: NightlyStatus = { version: 1, started: now().toISOString(), finished: null, result: "running", exitCode: null, exitMeaning: "running", steps: [], next: null };
  const save = () => { try { writeStatus(statusFile, status); } catch (e) { say(`could not write the status file: ${(e as Error).message}`); } };
  const record = (name: StepName, r: Omit<StepResult, "name" | "meaning" | "message"> & { message: string }) => {
    const step: StepResult = { name, ...r, message: oneLine(redact(r.message, secrets)), meaning: exitMeaning(r.exitCode), ...(r.peakMemoryMb === undefined ? {} : { peakMemoryMb: r.peakMemoryMb }) };
    status.steps.push(step); save();
    say(`step=${name} ${step.skipped ? "skipped" : step.ok ? "ok" : "FAILED"} exit=${step.exitCode ?? "-"} (${step.meaning}) ${step.seconds}s: ${step.message}`);
  };
  const aborted = () => !!o.signal?.aborted;
  say(`started; keep ${cfg.keep} backup(s)${cfg.offsiteCmd ? ", off-host copy on" : ""}${cfg.schedule ? `, schedule ${String(cfg.schedule.hour).padStart(2, "0")}:${String(cfg.schedule.minute).padStart(2, "0")} UTC` : ""}`);
  save();

  try {
    // ---- 1. backup ----
    let backupDir: string | null = null;
    {
      const t0 = Date.now(); let ok = false, message = "", code = 1;
      try {
        const backups = path.join(dataDir, "backups");
        const r = backupDatabases({
          root: backups, keep: Infinity, now: now(),
          files: [{ name: "ringside", path: dbPath }, { name: "accounts", path: o.env.ACCOUNTS_DB_PATH?.trim() || path.join(dataDir, "accounts.db"), private: true }],
          extra: [{ name: "model-fit", path: path.join(dataDir, "model-fit.json") }],
        });
        const bad = r.files.filter((f) => f.integrity !== "ok");
        const problems = !r.files.some((f) => f.name === "ringside") ? [`no sports database found at ${path.basename(dbPath)}`] : verifyBackup(r.dir, { requireChecksums: true }); // the sports database is required; accounts.db exists once someone has signed up
        if (bad.length || problems.length) {
          message = `${bad.length ? `integrity check failed for ${bad.map((f) => f.name).join(", ")}` : `verification found ${problems.length} problem(s): ${problems[0]}`}; the unusable copy was discarded and no old backup was removed`;
          fs.rmSync(r.dir, { recursive: true, force: true }); // ours, just made, and not a backup: it must not count towards NIGHTLY_KEEP or be offered as the newest
        } else {
          const pruned = pruneBackups(backups, cfg.keep); // only after the new one verified: a bad night never costs an old good copy
          ok = true; code = 0; backupDir = r.dir;
          message = `${path.basename(r.dir)} verified (${r.files.map((f) => f.name).join(", ")}${r.skipped.length ? `; skipped ${r.skipped.length}` : ""}); ${pruned.length} old one(s) removed, newest ${cfg.keep} kept`;
        }
      } catch (e) { message = `backup failed: ${(e as Error).message.replace(dataDir, "<data>")}`; }
      record("backup", { exitCode: code, ok, message, seconds: Math.round((Date.now() - t0) / 100) / 10 });
    }

    // ---- 2. the update ----
    let updateCode: number | null = null;
    if (aborted()) record("update", { exitCode: null, ok: false, skipped: true, message: "stopped before the update began", seconds: 0 });
    else {
      const t0 = Date.now();
      const key = o.env.BOXING_API_KEY?.trim();
      if (!key && !o.updateCommand) {
        updateCode = 1;
        record("update", { exitCode: 1, ok: false, message: "BOXING_API_KEY is not set in the container's environment, so there is nothing to update with", seconds: 0 });
      } else {
        const cmd = o.updateCommand ?? { file: process.execPath, args: ["--import", "tsx", "scripts/vendor-backfill.ts", "--update", "--cache-dir", path.join(dataDir, "vendor-cache"), "--no-backup", ...cfg.updateArgs] };
        say(`update: ${path.basename(cmd.file)} ${cmd.args.join(" ")} (node options: ${cfg.childNodeOptions}, MALLOC_ARENA_MAX ${o.env.MALLOC_ARENA_MAX ?? DEFAULT_MALLOC_ARENA_MAX})`);
        const out = await runChild({
          file: cmd.file, args: cmd.args, cwd: root, timeoutMs: o.updateTimeoutMs ?? UPDATE_TIMEOUT_MS, signal: o.signal, sampleMs: o.sampleMs,
          env: { ...o.env, NODE_OPTIONS: cfg.childNodeOptions, MALLOC_ARENA_MAX: o.env.MALLOC_ARENA_MAX ?? DEFAULT_MALLOC_ARENA_MAX },
          onLine: (l) => { if (l.trim()) say(`  | ${l}`); },
        });
        updateCode = out.spawnError ? 1 : out.timedOut ? 1 : out.code ?? signalNumber(out.signal) ?? 1;
        const lines = out.tail.map((l) => l.trim()).filter(Boolean);
        const loaded = /\bloaded: (.*)$/.exec(lines.find((l) => /\bloaded: /.test(l)) ?? "")?.[1];
        const skipped = lines.find((l) => /^update done, but /.test(l)); // the update's own last line when it skipped or ignored anything
        const message = out.spawnError ? `could not start the update: ${out.spawnError}`
          : out.timedOut ? `stopped: still running after ${Math.round((o.updateTimeoutMs ?? UPDATE_TIMEOUT_MS) / 60_000)} minutes`
          : updateCode === 0 ? `applied${loaded ? `: ${loaded}` : ""}${skipped ? `; ${skipped}` : ""}`
          : lines[lines.length - 1] ?? "no output";
        record("update", { exitCode: updateCode, ok: updateCode === 0, message, seconds: Math.round((Date.now() - t0) / 100) / 10, peakMemoryMb: out.peakMb });
        if (out.peakMb !== undefined) say(`update peak memory about ${out.peakMb} MB (its own process, beside the site)`);
      }
    }

    // ---- 2b. look at public sources for changes (optional: WATCH_SOURCES). It only stores proposals for an administrator; it never changes what the site shows,
    // and a failure here is a warning in the status, never a reason to fail the night or to skip the off-host copy.
    if (cfg.watch.watched.length) {
      const due = cfg.watch.watched.filter((w) => isDue(w, now()));
      if (aborted()) record("watch", { exitCode: null, ok: false, skipped: true, message: "stopped before the watch began", seconds: 0 });
      else if (!due.length) record("watch", { exitCode: null, ok: true, skipped: true, message: `nothing due tonight (${cfg.watch.watched.map((w) => `${w.id.split(":").pop()}:${w.every}`).join(", ")}; weekly sources run on Mondays, UTC)`, seconds: 0 });
      else {
        const t0 = Date.now(); const parts: string[] = []; let worst = 0;
        for (const w of due) {
          const name = w.id.split(":").pop()!;
          if (aborted()) { parts.push(`${name}: stopped`); worst ||= 1; break; }
          const cmd = o.watchCommand ? o.watchCommand(name) : { file: process.execPath, args: ["--import", "tsx", "scripts/watch.ts", "--source", name, "--cache-dir", path.join(dataDir, "wikipedia-cache")] };
          const seen: string[] = [];
          const out = await runChild({
            file: cmd.file, args: cmd.args, cwd: root, timeoutMs: o.watchTimeoutMs ?? WATCH_TIMEOUT_MS, signal: o.signal,
            env: { ...o.env, NODE_OPTIONS: cfg.childNodeOptions, MALLOC_ARENA_MAX: o.env.MALLOC_ARENA_MAX ?? DEFAULT_MALLOC_ARENA_MAX },
            onLine: (l) => { if (l.trim()) { seen.push(l.trim()); say(`  | watch: ${oneLine(l, 300)}`); } },
          });
          const code = out.spawnError ? 1 : out.timedOut ? 124 : out.code ?? signalNumber(out.signal) ?? 1;
          const summary = [...seen].reverse().find((l) => /^proposals: |^not proposed from /.test(l)) ?? "";
          parts.push(`${name}: ${out.spawnError ? "could not start" : out.timedOut ? "timed out" : code === 0 ? (summary || "looked, nothing to report") : code === 3 ? `a list was refused (${summary || "see the log"})` : `failed (exit ${code}): ${seen[seen.length - 1] ?? "no output"}`}`);
          if (code !== 0) worst ||= code;
        }
        record("watch", { exitCode: worst, ok: worst === 0, message: parts.join("; "), seconds: Math.round((Date.now() - t0) / 100) / 10 });
      }
    }

    // ---- 2c. refresh the boxing headlines and the official videos (optional: NEWS_REFRESH=1). Public feeds, polite (docs/news.md); a failure is a warning in the status, never a reason to
    // fail the night or to skip the off-host copy. It needs NEWS_CONTACT (the User-Agent's address), and the YouTube key in YOUTUBE_API_KEY if videos are wanted.
    if (cfg.news) {
      if (aborted()) record("news", { exitCode: null, ok: false, skipped: true, message: "stopped before the news refresh began", seconds: 0 });
      else if (!o.newsCommand && !(o.env.NEWS_CONTACT ?? "").trim()) record("news", { exitCode: 1, ok: false, message: "NEWS_REFRESH=1 but NEWS_CONTACT is not set (an email address or web page for the User-Agent): nothing was read", seconds: 0 });
      else {
        const t0 = Date.now(); const seen: string[] = [];
        const cmd = o.newsCommand ? o.newsCommand() : { file: process.execPath, args: ["--import", "tsx", "scripts/news-refresh.ts", "--database", dbPath] };
        const out = await runChild({
          file: cmd.file, args: cmd.args, cwd: root, timeoutMs: o.newsTimeoutMs ?? NEWS_TIMEOUT_MS, signal: o.signal,
          env: { ...o.env, NODE_OPTIONS: cfg.childNodeOptions, MALLOC_ARENA_MAX: o.env.MALLOC_ARENA_MAX ?? DEFAULT_MALLOC_ARENA_MAX },
          onLine: (l) => { if (l.trim()) { seen.push(l.trim()); say(`  | news: ${oneLine(redact(l, [o.env.YOUTUBE_API_KEY?.trim()]), 300)}`); } },
        });
        const code = out.spawnError ? 1 : out.timedOut ? 124 : out.code ?? signalNumber(out.signal) ?? 1;
        const summary = [...seen].reverse().find((l) => /new headlines; \d+ kept/.test(l)) ?? "";
        record("news", { exitCode: code, ok: code === 0, message: out.spawnError ? "could not start the news refresh" : out.timedOut ? "the news refresh timed out and was stopped" : code === 0 ? (summary || "refreshed") : `the news refresh failed (exit ${code}): ${oneLine(seen[seen.length - 1] ?? "no output", 160)}`, seconds: Math.round((Date.now() - t0) / 100) / 10 });
      }
    }

    // ---- 3. off-host copy ----
    if (!cfg.offsiteCmd) record("offsite", { exitCode: null, ok: true, skipped: true, message: "NIGHTLY_OFFSITE_CMD is not set: the backup stays on this volume only", seconds: 0 });
    else if (!backupDir) record("offsite", { exitCode: null, ok: false, skipped: true, message: "no verified backup to copy tonight", seconds: 0 });
    else if (aborted()) record("offsite", { exitCode: null, ok: false, skipped: true, message: "stopped before the copy began", seconds: 0 });
    else {
      const t0 = Date.now();
      // the command is the owner's own: it gets the environment minus the secrets it has no use for, and the folder as its one argument ($1)
      const env = { ...o.env }; delete env.BOXING_API_KEY; delete env.ANTHROPIC_API_KEY; delete env.YOUTUBE_API_KEY;
      const out = await runChild({
        file: "sh", args: ["-c", `${cfg.offsiteCmd} "$1"`, "nightly-offsite", backupDir], env, cwd: dataDir, timeoutMs: cfg.offsiteTimeoutMs, signal: o.signal, detached: true,
        onLine: (l) => { if (l.trim()) say(`  | offsite: ${oneLine(l, 300)}`); },
      });
      const code = out.spawnError ? 1 : out.timedOut ? 124 : out.code ?? signalNumber(out.signal);
      const ok = !out.spawnError && !out.timedOut && out.code === 0;
      const message = ok ? "copied" : out.timedOut ? `timed out after ${Math.round(cfg.offsiteTimeoutMs / 600) / 100} minute(s) and was stopped` : out.spawnError ? "could not start" : `the command ended with exit ${code ?? "?"}`;
      record("offsite", { exitCode: ok ? 0 : code ?? 1, ok, message: `${message}${ok ? "" : " (the backup is still on the volume; the update was not affected)"}`, seconds: Math.round((Date.now() - t0) / 100) / 10 });
    }
  } finally {
    const get = (n: StepName) => status.steps.find((s) => s.name === n);
    const upd = get("update"), bak = get("backup"), off = get("offsite"), wat = get("watch"), nws = get("news");
    const interrupted = aborted();
    let exitCode = 0, result: NightlyResult = "ok";
    if (interrupted) { exitCode = 130; result = "interrupted"; }
    else if (upd && !upd.ok) { exitCode = upd.exitCode ?? 1; result = "failed"; }
    else if (bak && !bak.ok) { exitCode = 1; result = "failed"; }
    else if ((off && !off.ok && !off.skipped) || (wat && !wat.ok && !wat.skipped) || (nws && !nws.ok && !nws.skipped)) result = "warning";
    const end = now();
    Object.assign(status, { finished: end.toISOString(), result, exitCode, exitMeaning: exitMeaning(exitCode), next: cfg.schedule ? nextSlot(end, cfg.schedule).toISOString() : null });
    save();
    releaseNightlyLock(lock);
    say(`finished: ${result}, exit ${exitCode} (${exitMeaning(exitCode)})${status.next ? `; next scheduled ${status.next}` : ""}`);
  }
  return { exitCode: status.exitCode ?? 1, status };
}

/** One sentence for the doctor and the logs. */
export function describeNightly(s: ReturnType<typeof publicNightly>): string | null {
  if (!s) return null;
  const when = s.finishedAt ?? s.startedAt;
  return s.result === "ok" ? `The last nightly job finished ${when.slice(0, 16).replace("T", " ")} UTC with everything done.`
    : s.result === "running" ? `A nightly job started ${when.slice(0, 16).replace("T", " ")} UTC and has not finished.`
    : `The last nightly job (${when.slice(0, 16).replace("T", " ")} UTC) ended "${s.result}" with exit code ${s.exitCode ?? "?"} (${exitMeaning(s.exitCode)}).`;
}
