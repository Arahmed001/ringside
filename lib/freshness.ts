import type { DatabaseSync } from "node:sqlite";

/**
 * How old the sports data is. A licensed feed is kept current by a daily job (`npm run vendor:backfill -- --update`); when that job stops
 * (a cron that never ran, an expired key, a full disk) nothing fails: the site keeps answering with yesterday's, then last week's, results.
 * This is the one number that shows it.
 */
export const STALE_DATA_DAYS = 2;

/** Runs written by the money pipeline are not updates of the fights. */
const NOT_SPORTS = ["money", "research"];

export interface Update { at: string; provider: string }

/** The newest successful load or update of the sports data, or null (no run, or no ingest table yet). */
export function latestUpdate(db: DatabaseSync): Update | null {
  try {
    const marks = NOT_SPORTS.map(() => "?").join(",");
    const r = db.prepare(`SELECT at, provider FROM ingest_runs WHERE provider NOT IN (${marks}) AND provider NOT LIKE 'research-%' ORDER BY id DESC LIMIT 1`).get(...NOT_SPORTS) as Update | undefined;
    return r?.at ? { at: r.at, provider: r.provider } : null;
  } catch { return null; }
}

/** Age in hours, and whether it is older than the daily job should ever leave it. */
export function dataAge(at: string, nowMs: number): { ageHours: number; stale: boolean } | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const ageHours = Math.max(0, (nowMs - t) / 3_600_000);
  return { ageHours: Math.round(ageHours * 10) / 10, stale: ageHours > STALE_DATA_DAYS * 24 };
}
