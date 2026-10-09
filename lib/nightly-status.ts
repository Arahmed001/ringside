import fs from "node:fs";
import path from "node:path";

/**
 * The optional in-container nightly job (`npm run nightly`, docs/nightly.md) leaves one small file beside the database, `nightly-status.json`: when it started and
 * finished, what each step returned, and when the next run is due. This module only reads and writes that file, with nothing heavy imported, so the health route, the
 * doctor and the scheduler can all use it. Nothing in it is a secret; /api/health still shows only the coarse `publicNightly` part (no message, no path).
 */
export const STATUS_FILE = "nightly-status.json";
/** A run that says it is still running after this long is treated as dead (killed with its container): no real run lasts so long (the update times out at 4 h). */
export const RUNNING_STALE_HOURS = 6;

/** The settings the job and its scheduler read. Listed here (not scattered) so the doctor, the docs and the drift test agree; they are all optional. */
export type NightlyEnv = Record<"NIGHTLY_SCHEDULE" | "NIGHTLY_KEEP" | "NIGHTLY_OFFSITE_CMD" | "NIGHTLY_OFFSITE_TIMEOUT_MIN" | "NIGHTLY_JITTER_MIN" | "NIGHTLY_NODE_OPTIONS" | "RINGSIDE_NIGHTLY_UPDATE_ARGS" | "WATCH_SOURCES" | "NEWS_REFRESH" | "NIGHTLY_ENRICH" | "NIGHTLY_PING_URL", string | undefined>;
export const nightlyEnv = (): NightlyEnv => ({
  NIGHTLY_SCHEDULE: process.env.NIGHTLY_SCHEDULE, NIGHTLY_KEEP: process.env.NIGHTLY_KEEP, NIGHTLY_OFFSITE_CMD: process.env.NIGHTLY_OFFSITE_CMD,
  NIGHTLY_OFFSITE_TIMEOUT_MIN: process.env.NIGHTLY_OFFSITE_TIMEOUT_MIN, NIGHTLY_JITTER_MIN: process.env.NIGHTLY_JITTER_MIN, NIGHTLY_NODE_OPTIONS: process.env.NIGHTLY_NODE_OPTIONS,
  RINGSIDE_NIGHTLY_UPDATE_ARGS: process.env.RINGSIDE_NIGHTLY_UPDATE_ARGS, WATCH_SOURCES: process.env.WATCH_SOURCES, NEWS_REFRESH: process.env.NEWS_REFRESH, NIGHTLY_ENRICH: process.env.NIGHTLY_ENRICH, NIGHTLY_PING_URL: process.env.NIGHTLY_PING_URL,
});

/**
 * What an exit code means (PLAN.md section 224; the same table as docs/load-day.md step 8). The first block is the update's own, passed through as the job's code;
 * the job adds nothing of its own except that a failed backup with a good update is 1. 4 and above are not used here.
 */
export const EXIT_MEANING: Record<number, string> = {
  0: "done",
  1: "anything else (a missing key, a bad option, the clock message, a backup or database error)",
  2: "the vendor is unreachable or refused",
  3: "a check refused the data (nothing was written)",
  75: "another run holds the lock (try again later)",
  130: "stopped by SIGINT, SIGTERM or SIGHUP",
};
export const exitMeaning = (code: number | null): string => (code === null ? "not run" : EXIT_MEANING[code] ?? (code > 128 ? `killed by signal ${code - 128}` : "anything else"));

export type StepName = "backup" | "update" | "watch" | "news" | "offsite" | "enrich";
export interface StepResult {
  name: StepName;
  /** null: the step did not run (cut short, or an offsite command was never set) */
  exitCode: number | null;
  ok: boolean;
  skipped?: boolean;
  /** one line, no secret: the key is cut out and an offsite command's own words are never kept */
  message: string;
  meaning: string;
  seconds: number;
  /** the update's largest resident memory seen while it ran, in MB (Linux only) */
  peakMemoryMb?: number;
}
export type NightlyResult = "running" | "ok" | "warning" | "failed" | "interrupted";
export interface NightlyStatus {
  version: 1;
  started: string;
  finished: string | null;
  result: NightlyResult;
  /** the job's own exit code: the update's if it failed, else 1 for a failed backup, else 0; null while running */
  exitCode: number | null;
  exitMeaning: string;
  steps: StepResult[];
  /** the next scheduled start, when NIGHTLY_SCHEDULE is on; null when the job is only run by hand */
  next: string | null;
}

/** Where the file lives: in the data folder (the one holding the database), which is the volume. */
export function statusPath(env: Record<string, string | undefined> = { DATABASE_PATH: process.env.DATABASE_PATH }): string {
  return path.join(path.dirname(env.DATABASE_PATH?.trim() || path.join(process.cwd(), "data", "ringside.db")), STATUS_FILE);
}

/** Written whole to a side file and renamed, so a reader never sees half of it. */
export function writeStatus(file: string, s: NightlyStatus): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

const RESULTS = new Set<string>(["running", "ok", "warning", "failed", "interrupted"]);
/** The file, or null when it is missing, unreadable or not the shape this version writes (a reader never throws on it). */
export function readStatus(file: string): NightlyStatus | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<NightlyStatus>;
    if (!j || j.version !== 1 || typeof j.started !== "string" || !Number.isFinite(Date.parse(j.started)) || !RESULTS.has(String(j.result)) || !Array.isArray(j.steps)) return null;
    return j as NightlyStatus;
  } catch { return null; }
}

/** What /api/health says: a few facts, no message, no path, no key. */
export interface PublicNightly {
  result: NightlyResult;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  /** each step's exit code (null: it did not run) */
  steps: Partial<Record<StepName, number | null>>;
  next: string | null;
}
export function publicNightly(s: NightlyStatus | null, nowMs = Date.now()): PublicNightly | null {
  if (!s) return null;
  const dead = s.result === "running" && nowMs - Date.parse(s.started) > RUNNING_STALE_HOURS * 3_600_000; // killed with its container, never finished
  const steps: PublicNightly["steps"] = {};
  for (const st of s.steps) if (["backup", "update", "watch", "offsite"].includes(st.name)) steps[st.name] = typeof st.exitCode === "number" ? st.exitCode : null;
  const text = (x: unknown) => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? x : null);
  return { result: dead ? "interrupted" : s.result, startedAt: s.started, finishedAt: text(s.finished), exitCode: typeof s.exitCode === "number" ? s.exitCode : null, steps, next: text(s.next) };
}

/** The job's last result for the health route and the doctor: null when the job has never run (or is not used). */
export const lastNightly = (env?: Record<string, string | undefined>, nowMs?: number): PublicNightly | null => publicNightly(readStatus(statusPath(env)), nowMs);

/** `HH:MM` (UTC) or null when it is off or not that. */
export function parseSchedule(text: string | undefined): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((text ?? "").trim());
  return m ? { hour: +m[1], minute: +m[2] } : null;
}
/** The first start at HH:MM UTC strictly after `from`. */
export function nextSlot(from: Date, s: { hour: number; minute: number }): Date {
  const t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), s.hour, s.minute);
  return new Date(t > from.getTime() ? t : t + 86_400_000);
}
