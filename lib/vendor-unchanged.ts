import type { DatabaseSync } from "node:sqlite";
import type { ProviderBout, ProviderEvent } from "./providers";

/**
 * The daily update looks back 14 days (so a late result is caught) and, until now, fetched every fighter of every fight in that window again, every night: about 13 of every 14 fetches
 * were for fights it had already loaded and that had not changed. A fight is "unchanged" when the database already holds it with the same date, fighters, result and status as the feed
 * lists now. Only the fighters of fights that are NEW or CHANGED are fetched again. The comparison is deliberately strict and errs towards fetching: a field the database stores in
 * another form (a result the feed called unsettled, a result an approved source filled in) simply makes the fight count as changed, costing a fetch and never a missed update.
 */
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function boutSignature(b: ProviderBout, eventDate: string | undefined): string {
  return [eventDate, b.redExternalId, b.blueExternalId, b.rounds, b.winnerExternalId, b.method, b.endRound, b.status, b.title, b.roundTime, b.kdRed, b.kdBlue].map(s).join("|");
}

/** What the database holds for fights on or after `since`, in the same form as `boutSignature` (fight external id → signature). */
export function knownSignatures(db: DatabaseSync, since: string): Map<string, string> {
  const rows = db.prepare(`SELECT b.external_id id, e.date date, r.external_id red, bl.external_id blue, b.rounds rounds, w.external_id win, b.method method, b.end_round endRound, b.status status,
      b.title title, b.round_time roundTime, b.kd_red kdRed, b.kd_blue kdBlue
    FROM bouts b JOIN events e ON e.id = b.event_id JOIN boxers r ON r.id = b.red_id JOIN boxers bl ON bl.id = b.blue_id LEFT JOIN boxers w ON w.id = b.winner_id
    WHERE e.date >= ?`).all(since) as Record<string, string | number | null>[];
  const out = new Map<string, string>();
  for (const r of rows) out.set(String(r.id), [r.date, r.red, r.blue, r.rounds, r.win, r.method, r.endRound, r.status, r.title, r.roundTime, r.kdRed, r.kdBlue].map(s).join("|"));
  return out;
}

/**
 * The fights to load, the count left out, and the fighters of the ones kept. A fight that is new or changed is kept. So is an unchanged fight when `needsRefresh` says one of its
 * fighters has not been fetched lately (a profile change, such as a corrected country, never shows in a fight, so each fighter is still fetched again every few days).
 */
export function dropUnchanged(bouts: ProviderBout[], events: Map<string, ProviderEvent>, known: Map<string, string>, needsRefresh: (fighterExternalId: string) => boolean = () => false): { kept: ProviderBout[]; skipped: number; keptForAge: number; fighters: Set<string> } {
  const kept: ProviderBout[] = [], fighters = new Set<string>();
  let keptForAge = 0;
  for (const b of bouts) {
    if (known.get(b.externalId) === boutSignature(b, events.get(b.eventExternalId)?.date)) {
      if (!needsRefresh(b.redExternalId) && !needsRefresh(b.blueExternalId)) continue;
      keptForAge++;
    }
    kept.push(b); fighters.add(b.redExternalId); fighters.add(b.blueExternalId);
  }
  return { kept, skipped: bouts.length - kept.length, keptForAge, fighters };
}
