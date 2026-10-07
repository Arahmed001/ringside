import type { NightlyStatus } from "./nightly-status";

/**
 * The optional scheduler for hosts with no cron (NIGHTLY_SCHEDULE='HH:MM', UTC). It is a separate small process started beside the site by
 * scripts/docker-entrypoint.sh, never part of the web server, and the job it starts is a child of its own, so the update's memory is not the site's.
 *
 * Every half minute it asks one question: is today's slot (HH:MM UTC, plus a few minutes of random jitter) behind us, and has no run STARTED since that slot?
 * The answer comes from the status file on the volume, not from memory, so a restart cannot run the job twice in a day (a job that began is recorded even if
 * it failed), and a container that was down at the slot runs it on coming back, after a grace period for the site to start. An interrupted run is not repeated
 * the same day: run `npm run nightly` by hand. All the clocks and timers are injected so a test can drive a day in milliseconds.
 */
export const DEFAULT_JITTER_MIN = 5, MAX_JITTER_MIN = 60;
export const TICK_MS = 30_000;
/** After the scheduler starts, wait this long before a run that is already due: the site is building its world, and the update should not add to that peak. */
export const START_DELAY_MS = 10 * 60_000;

/** NIGHTLY_JITTER_MIN: whole or fractional minutes, 0 to 60; anything else is the default. */
export function jitterMinutes(text: string | undefined): number {
  if (text === undefined || text.trim() === "") return DEFAULT_JITTER_MIN;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= MAX_JITTER_MIN ? n : DEFAULT_JITTER_MIN;
}
/** A random delay from 0 up to (not including) `minutes` minutes. `random` is Math.random in use. */
export const jitterMs = (minutes: number, random: () => number): number => Math.floor(Math.max(0, Math.min(0.999999, random())) * minutes * 60_000);

export const slotOn = (day: Date, s: { hour: number; minute: number }): Date => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), s.hour, s.minute));

export interface SchedulerDeps {
  schedule: { hour: number; minute: number };
  jitterMin: number;
  now: () => Date;
  random: () => number;
  /** the status file's content (null: none) */
  readStatus: () => NightlyStatus | null;
  /** starts the job and resolves with its exit code when it ends */
  runJob: () => Promise<number | null>;
  log: (line: string) => void;
  setInterval?: (f: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  tickMs?: number;
  startDelayMs?: number;
}
export interface Scheduler { start(): void; tick(): Promise<"ran" | "waiting" | "busy">; stop(): void; readonly running: boolean }

export function createScheduler(d: SchedulerDeps): Scheduler {
  const startedAt = d.now().getTime();
  const jitters = new Map<string, number>(); // one random delay per day, kept for the day
  let running = false, handle: unknown, stopped = false;
  const pad = (n: number) => String(n).padStart(2, "0");
  const slotName = `${pad(d.schedule.hour)}:${pad(d.schedule.minute)}`;
  async function tick(): Promise<"ran" | "waiting" | "busy"> {
    if (running || stopped) return "busy";
    const now = d.now();
    const slot = slotOn(now, d.schedule);
    if (now.getTime() < slot.getTime()) return "waiting";
    const key = slot.toISOString().slice(0, 10);
    if (!jitters.has(key)) { const j = jitterMs(d.jitterMin, d.random); jitters.set(key, j); d.log(`[nightly-scheduler] today's run is due at ${slotName} UTC plus ${Math.round(j / 1000)} s of jitter`); }
    if (now.getTime() < slot.getTime() + jitters.get(key)!) return "waiting";
    const last = d.readStatus();
    if (last && Date.parse(last.started) >= slot.getTime()) return "waiting"; // a run began since the slot (this process, an earlier one, or a hand run): once a day
    if (now.getTime() < startedAt + (d.startDelayMs ?? START_DELAY_MS)) return "waiting"; // just (re)started: let the site settle first
    running = true;
    d.log(`[nightly-scheduler] starting the nightly job (${now.toISOString()})`);
    try {
      const code = await d.runJob();
      d.log(`[nightly-scheduler] the nightly job ended with exit code ${code ?? "?"}`);
    } catch (e) { d.log(`[nightly-scheduler] could not run the nightly job: ${(e as Error).message}`); }
    finally { running = false; }
    return "ran";
  }
  return {
    start() {
      d.log(`[nightly-scheduler] on: every day at ${slotName} UTC (+ up to ${d.jitterMin} min of jitter)`);
      const set = d.setInterval ?? ((f, ms) => setInterval(f, ms));
      handle = set(() => { tick().catch((e) => d.log(`[nightly-scheduler] ${(e as Error).message}`)); }, d.tickMs ?? TICK_MS);
    },
    tick,
    stop() { stopped = true; if (handle !== undefined) (d.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout)))(handle); handle = undefined; },
    get running() { return running; },
  };
}

