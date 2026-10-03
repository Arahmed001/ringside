import type { DatabaseSync } from "node:sqlite";
import type { BackfillPlan } from "./providers/boxing-data-api";

/** Every fighter the Boxing Data API adapter creates has an external id starting with this (see fighterId in lib/providers/boxing-data-api.ts). */
export const FEED_FIGHTER_PREFIX = "bda-f-";

/**
 * What is already in a database, against what the vendor feed would put there. Loading real fighters next to the fictional demo league
 * (or another feed's fighters) would mix invented people in with real ones under the same rankings, so the backfill checks first.
 */
export function foreignFighters(db: DatabaseSync): { total: number; fromFeed: number; foreign: number; example: string | null } {
  const q = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const total = q("SELECT COUNT(*) c FROM boxers");
  const fromFeed = q(`SELECT COUNT(*) c FROM boxers WHERE external_id LIKE '${FEED_FIGHTER_PREFIX}%'`);
  const example = (db.prepare(`SELECT name FROM boxers WHERE external_id NOT LIKE '${FEED_FIGHTER_PREFIX}%' LIMIT 1`).get() as { name: string } | undefined)?.name ?? null;
  return { total, fromFeed, foreign: total - fromFeed, example };
}

/**
 * Where a daily update starts: the date of the latest card that has already happened, less an overlap, so a result that arrived late or a
 * card the last run caught before it finished is picked up. Null when nothing has happened yet (there is nothing to update: backfill first).
 */
export function updateSince(db: DatabaseSync, today: string, overlapDays = 14): string | null {
  const row = db.prepare("SELECT MAX(date) d FROM events WHERE date <= ? AND COALESCE(status, '') != 'cancelled'").get(today) as { d: string | null };
  if (!row.d) return null;
  return new Date(Date.parse(row.d) - overlapDays * 86400000).toISOString().slice(0, 10);
}

/** What `--plan` prints: the size of the job and a rough time for it. */
export function describePlan(p: BackfillPlan, o: { gapMs: number; msPerRequest?: number; perHour?: number }): string[] {
  const paced = o.perHour && o.perHour > 0 ? 3_600_000 / o.perHour : 0; // an hourly limit sets the pace when it is slower than the spacing
  const ms = Math.max(o.gapMs + (o.msPerRequest ?? 250), paced); // the wait between requests plus a typical round trip
  const mins = Math.ceil((p.fighterRequests * ms) / 60000);
  return [
    `fights ${p.fights}, events ${p.events}, fighters ${p.fighters}`,
    `fight list pages fetched to find out: ${p.requestsMade} request(s)`,
    `fighters already in the cache (free): ${p.fightersCached}`,
    paced > 0 ? `fighters still to fetch: ${p.fighterRequests} request(s), about ${mins >= 120 ? `${Math.round(mins / 6) / 10} hours` : `${mins} minute(s)`} at ${o.perHour} requests an hour`
      : `fighters still to fetch: ${p.fighterRequests} request(s), about ${mins} minute(s) at ${o.gapMs} ms between requests`,
    `total still to spend: about ${p.fighterRequests} request(s) (plus any retries)`,
  ];
}
