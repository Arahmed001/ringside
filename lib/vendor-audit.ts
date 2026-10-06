import type { DatabaseSync } from "node:sqlite";
import { DIVISION_NAMES } from "./divisions";
import { canonicalCountry, flag } from "./format";
import { AMATEUR_EVENT } from "./providers/boxing-data-api";
import { latestUpdate } from "./freshness";
import { lagDays } from "./vendor-backfill";

/**
 * `npm run vendor:audit` (round 106): what a loaded database must look like, checked in a second or two straight after a load. Each check is one of the things that went wrong
 * on the first real load and was only found by looking at pages (every belt under "Unsanctioned", one country split into a name and a demonym, fights that were cancelled shown
 * as fights with no result, Olympic bouts on a professional record), so the next load is told at once. It reads the database and nothing else.
 */
export type Level = "pass" | "info" | "warn" | "fail";
export interface Check { id: string; level: Level; title: string; detail: string }

const WHITE_FLAG = "🏳️";
const count = (db: DatabaseSync, sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const sample = (xs: string[], n = 4) => xs.slice(0, n).join("; ") + (xs.length > n ? `; and ${xs.length - n} more` : "");
const pctOf = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : "0.0") + "%";

export function auditDatabase(db: DatabaseSync, today: string): Check[] {
  const out: Check[] = [];
  const add = (id: string, level: Level, title: string, detail: string) => out.push({ id, level, title, detail });
  const boxers = count(db, "SELECT COUNT(*) n FROM boxers"), bouts = count(db, "SELECT COUNT(*) n FROM bouts"), events = count(db, "SELECT COUNT(*) n FROM events");
  add("size", boxers > 0 && bouts > 0 ? "info" : "fail", "what is in it", `${boxers.toLocaleString("en-US")} fighters, ${bouts.toLocaleString("en-US")} bouts, ${events.toLocaleString("en-US")} events`);

  // every belt on the line belongs to a body (otherwise the Titles pages call it "Unsanctioned")
  const titled = count(db, "SELECT COUNT(*) n FROM bouts WHERE title IS NOT NULL AND title <> '' AND COALESCE(status,'') <> 'cancelled'");
  const noBody = db.prepare("SELECT DISTINCT title FROM bouts WHERE title IS NOT NULL AND title <> '' AND title_org_id IS NULL AND COALESCE(status,'') <> 'cancelled' ORDER BY title").all() as { title: string }[];
  const bodies = count(db, "SELECT COUNT(*) n FROM orgs WHERE kind = 'sanctioning_body'");
  add("belt-bodies", noBody.length ? "fail" : "pass", "every belt has a sanctioning body", noBody.length
    ? `${noBody.length} title name(s) have no body, so the Titles pages say "Unsanctioned": ${sample(noBody.map((r) => r.title))}`
    : `${titled.toLocaleString("en-US")} title bouts, ${bodies} bodies`);

  // countries: every fighter's country can be placed (a flag, an Arabic name), and is spelled its one way
  const countries = db.prepare("SELECT country, COUNT(*) n FROM boxers GROUP BY country ORDER BY n DESC").all() as { country: string; n: number }[];
  const unplaced = countries.filter((c) => c.country !== "Unknown" && flag(c.country) === WHITE_FLAG);
  const unplacedN = unplaced.reduce((s, c) => s + c.n, 0);
  add("countries-placed", unplacedN === 0 ? "pass" : unplacedN / Math.max(1, boxers) > 0.01 ? "fail" : "warn", "every fighter's country can be placed",
    unplacedN === 0 ? `${countries.length} countries, none unplaced` : `${unplacedN} fighter(s) (${pctOf(unplacedN, boxers)}) in ${unplaced.length} countr${unplaced.length === 1 ? "y" : "ies"} the app cannot place: ${sample(unplaced.map((c) => `${c.country} ${c.n}`))}`);
  const respelled = countries.filter((c) => c.country !== "Unknown" && flag(c.country) !== WHITE_FLAG && canonicalCountry(c.country) !== c.country && !/^(england|scotland|wales|northern ireland)$/i.test(c.country));
  add("countries-one-spelling", respelled.length ? "warn" : "pass", "every country is spelled its one way", respelled.length ? `${respelled.length} spelling(s) of a country that has another: ${sample(respelled.map((c) => `${c.country} (${canonicalCountry(c.country)})`))}` : "no country has two spellings");

  // fights that never happened are cancelled, not "no result"; a card of nothing but cancelled fights is not a card
  const cancelledOnly = count(db, "SELECT COUNT(*) n FROM events e WHERE EXISTS (SELECT 1 FROM bouts b WHERE b.event_id = e.id) AND NOT EXISTS (SELECT 1 FROM bouts b WHERE b.event_id = e.id AND COALESCE(b.status,'') <> 'cancelled')");
  add("no-cancelled-only-cards", cancelledOnly ? "fail" : "pass", "no card is made only of cancelled fights", cancelledOnly ? `${cancelledOnly} event(s) have only cancelled bouts` : `${count(db, "SELECT COUNT(*) n FROM bouts WHERE status = 'cancelled'").toLocaleString("en-US")} cancelled bouts, all on cards that were held`);

  // amateur and multi-sport events are not professional fights
  const amateur = (db.prepare("SELECT name FROM events").all() as { name: string }[]).filter((e) => AMATEUR_EVENT.test(e.name)).map((e) => e.name);
  add("no-amateur-events", amateur.length ? "fail" : "pass", "no amateur or multi-sport event is on the record", amateur.length ? `${amateur.length} event(s): ${sample(amateur)}` : "none");

  // results: none for a fight not yet held; a share without one is the supplier's gap
  const future = count(db, "SELECT COUNT(*) n FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date > ? AND b.method IS NOT NULL AND COALESCE(b.status,'') <> 'cancelled'", today);
  add("no-future-results", future ? "fail" : "pass", "no result for a fight that has not been held", future ? `${future} bout(s) at events after ${today} have a result` : "none");
  const cutoff = new Date(Date.parse(today + "T12:00:00Z") - 30 * 86400000).toISOString().slice(0, 10);
  const gaps = count(db, "SELECT COUNT(*) n FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date < ? AND b.method IS NULL AND COALESCE(b.status,'') <> 'cancelled'", cutoff);
  add("result-gaps", "info", "fights over a month old with no result", `${gaps.toLocaleString("en-US")} (${pctOf(gaps, bouts)} of bouts): the supplier's gap, shown as "no result yet"`);

  // the same fighter twice on one night
  const doubles = count(db, `SELECT COUNT(*) n FROM (SELECT f, d FROM (SELECT b.red_id f, e.date d FROM bouts b JOIN events e ON e.id = b.event_id WHERE COALESCE(b.status,'') <> 'cancelled'
    UNION ALL SELECT b.blue_id, e.date FROM bouts b JOIN events e ON e.id = b.event_id WHERE COALESCE(b.status,'') <> 'cancelled') GROUP BY f, d HAVING COUNT(*) > 1)`);
  add("double-booked", doubles ? "warn" : "pass", "no fighter is on two bouts one night", doubles ? `${doubles} fighter-night(s): usually one fight listed under two supplier ids` : "none");

  // careers: a record that loaded fights push past the supplier's own total must be marked disputed (the loader marks them), unless the last fight was too recent at the load for the total to have caught up
  // judged from the day of the load, as the loader judged it: a fighter whose last fight was inside the lag window then was left unmarked on purpose (the supplier's totals trail its results)
  const loadDay = (latestUpdate(db)?.at ?? today).slice(0, 10), lagWindow = lagDays("load");
  const lagFrom = new Date(Date.parse(loadDay + "T12:00:00Z") - lagWindow * 86400000).toISOString().slice(0, 10);
  const excess = db.prepare(`WITH f AS (SELECT b.red_id id, b.winner_id w, b.method m, e.date d FROM bouts b JOIN events e ON e.id = b.event_id WHERE COALESCE(b.status,'') <> 'cancelled' AND b.method IS NOT NULL
      UNION ALL SELECT b.blue_id, b.winner_id, b.method, e.date FROM bouts b JOIN events e ON e.id = b.event_id WHERE COALESCE(b.status,'') <> 'cancelled' AND b.method IS NOT NULL),
    t AS (SELECT id, SUM(CASE WHEN w = id THEN 1 ELSE 0 END) wins, SUM(CASE WHEN w IS NOT NULL AND w <> id THEN 1 ELSE 0 END) losses, SUM(CASE WHEN m = 'DRAW' THEN 1 ELSE 0 END) draws, MAX(d) last FROM f GROUP BY id)
    SELECT x.name, t.last FROM t JOIN boxers x ON x.id = t.id WHERE x.vendor_wins IS NOT NULL AND COALESCE(x.record_disputed, 0) = 0 AND (t.wins > x.vendor_wins OR t.losses > x.vendor_losses OR t.draws > x.vendor_draws)`).all() as { name: string; last: string }[];
  const stale = excess.filter((r) => r.last < lagFrom), lagging = excess.length - stale.length;
  add("records-marked", stale.length ? "fail" : "pass", "a record the fights contradict is marked disputed", stale.length ? `${stale.length} fighter(s) have more wins, losses or draws loaded than the supplier's total and are not marked: ${sample(stale.map((r) => r.name))}` : `none unmarked${lagging ? `; ${lagging} are ahead of the supplier's total only by a fight in the ${lagWindow} days before the load (${loadDay}): its total lags` : ""}`);
  const disputed = count(db, "SELECT COUNT(*) n FROM boxers WHERE record_disputed = 1"), vend = count(db, "SELECT COUNT(*) n FROM boxers WHERE vendor_wins IS NOT NULL");
  add("disputed-share", vend && disputed / vend > 0.1 ? "warn" : "info", "how many records are disputed", `${disputed.toLocaleString("en-US")} of ${vend.toLocaleString("en-US")} fighters with a supplier record (${pctOf(disputed, vend)}); expect a few percent`);

  // divisions and the links between rows
  const known = DIVISION_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const odd = db.prepare(`SELECT weight_class w, COUNT(*) n FROM boxers WHERE weight_class NOT IN (${known}) GROUP BY weight_class ORDER BY n DESC`).all() as { w: string; n: number }[];
  const oddN = odd.reduce((s, r) => s + r.n, 0);
  add("divisions", oddN === 0 ? "pass" : oddN / Math.max(1, boxers) > 0.01 ? "fail" : "warn", "every fighter has a division the app knows", oddN === 0 ? "all placed" : `${oddN} fighter(s) (${pctOf(oddN, boxers)}) in: ${sample(odd.map((r) => `${r.w || "(none)"} ${r.n}`))}`);
  const orphans = count(db, "SELECT COUNT(*) n FROM bouts b WHERE NOT EXISTS (SELECT 1 FROM boxers x WHERE x.id = b.red_id) OR NOT EXISTS (SELECT 1 FROM boxers x WHERE x.id = b.blue_id) OR NOT EXISTS (SELECT 1 FROM events e WHERE e.id = b.event_id)");
  add("no-orphans", orphans ? "fail" : "pass", "every bout has its fighters and its event", orphans ? `${orphans} bout(s) point at a missing row` : "none");
  return out;
}

export const failed = (checks: Check[]): Check[] => checks.filter((c) => c.level === "fail");
const MARK: Record<Level, string> = { pass: "PASS", info: "info", warn: "WARN", fail: "FAIL" };
/** The report: each check with its detail under it, and a last line with the verdict. */
export function describeAudit(checks: Check[]): string[] {
  const lines: string[] = [];
  for (const c of checks) lines.push(`${MARK[c.level]}  ${c.title}`, `      ${c.detail}`);
  const f = failed(checks).length, w = checks.filter((c) => c.level === "warn").length;
  lines.push("", f ? `${f} check(s) FAILED${w ? `, ${w} warning(s)` : ""}: something in this load is wrong; read the FAIL lines.` : `All checks passed${w ? `, ${w} warning(s) to read` : ""}.`);
  return lines;
}
