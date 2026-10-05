import type { DatabaseSync } from "node:sqlite";
import { msg } from "./i18n/t";
import { getDb, dbVersion } from "./db";
import { todayIso } from "./clock";

export interface CoverageRow { field: string; have: number; of: number; note?: string }
export interface CoverageGroup { title: string; rows: CoverageRow[] }

/** Live field-by-field completeness, straight from the database. */
export interface LastRun {
  at: string; provider: string; errors: number; warnings: number; infos: number;
  counts: Record<string, number>; dropped: Record<string, number>;
  issues: { severity: string; code: string; n: number; example: string }[];
}

export interface Coverage { lastRun: LastRun | null; groups: CoverageGroup[]; stintSources: { source: string; n: number }[]; weighInSources: { source: string; n: number }[]; wikidataStaged: number; wikidataLinked: number }

const cached = globalThis as unknown as { __coverage?: { key: string; value: Coverage } };

/** About twenty COUNT / COUNT DISTINCT scans (a quarter of a second at 160k bouts), so they run once per database version, not per page view. */
export async function coverage(): Promise<Coverage> {
  const db = await getDb();
  const key = dbVersion(db);
  if (cached.__coverage?.key === key) return cached.__coverage.value;
  const value = computeCoverage(db);
  cached.__coverage = { key, value };
  return value;
}

function computeCoverage(db: DatabaseSync): Coverage {
  const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const boxers = n("SELECT COUNT(*) c FROM boxers");
  const done = n("SELECT COUNT(*) c FROM bouts WHERE method IS NOT NULL");
  const decisions = n("SELECT COUNT(*) c FROM bouts WHERE method IN ('UD','SD','MD','DRAW','TD','TDRAW')");
  const stoppages = n("SELECT COUNT(*) c FROM bouts WHERE method IN ('KO','TKO')");
  // A coverage figure counts only rows of the same bouts its total counts, so it can never read above 100% (an announced card has corners and weights before it has a result).
  const inDone = "bout_id IN (SELECT id FROM bouts WHERE method IS NOT NULL)";
  const inDecisions = "bout_id IN (SELECT id FROM bouts WHERE method IN ('UD','SD','MD','DRAW','TD','TDRAW'))";
  const activeBoxers = n("SELECT COUNT(*) c FROM boxers WHERE active = 1");
  const groups: CoverageGroup[] = [
    {
      title: msg("Fighters"),
      rows: [
        { field: msg("Exact birth date"), have: n("SELECT COUNT(*) c FROM boxers WHERE birth_date IS NOT NULL"), of: boxers },
        { field: msg("Birthplace"), have: n("SELECT COUNT(*) c FROM boxers WHERE birth_place IS NOT NULL"), of: boxers },
        { field: msg("Residence"), have: n("SELECT COUNT(*) c FROM boxers WHERE residence IS NOT NULL"), of: boxers },
        { field: msg("Wikidata link"), have: n("SELECT COUNT(*) c FROM boxers WHERE wikidata_id IS NOT NULL"), of: boxers },
        { field: msg("Hall of Fame ID (Wikidata)"), have: n("SELECT COUNT(*) c FROM boxers WHERE ibhof_id IS NOT NULL"), of: boxers },
        { field: msg("Olympedia ID (Wikidata)"), have: n("SELECT COUNT(*) c FROM boxers WHERE olympedia_id IS NOT NULL"), of: boxers, note: msg("amateur pedigree") },
        { field: msg("Honours or awards on record"), have: n("SELECT COUNT(DISTINCT boxer_id) c FROM honours"), of: boxers },
        { field: msg("World title reign on record (Wikipedia lists)"), have: n("SELECT COUNT(DISTINCT boxer_id) c FROM title_reigns WHERE boxer_id IS NOT NULL"), of: boxers },
        { field: msg("BoxRec ID (cross-reference only)"), have: n("SELECT COUNT(*) c FROM boxers WHERE boxrec_id IS NOT NULL"), of: boxers },
        { field: msg("Photo (licensed or Wikimedia)"), have: n("SELECT COUNT(*) c FROM boxers WHERE photo_url IS NOT NULL"), of: boxers, note: msg("otherwise a generated portrait") },
        { field: msg("Current head trainer"), have: n("SELECT COUNT(DISTINCT boxer_id) c FROM team_stints WHERE role='head_trainer' AND end_date IS NULL"), of: activeBoxers, note: msg("active fighters") },
        { field: msg("Current manager"), have: n("SELECT COUNT(DISTINCT boxer_id) c FROM team_stints WHERE role='manager' AND end_date IS NULL"), of: activeBoxers, note: msg("active fighters") },
        { field: msg("Trainer history (2+ trainers on record)"), have: n("SELECT COUNT(*) c FROM (SELECT boxer_id FROM team_stints WHERE role='head_trainer' GROUP BY boxer_id HAVING COUNT(*) >= 2)"), of: boxers },
      ],
    },
    {
      title: msg("Bouts"),
      rows: [
        { field: msg("Venue photo (free-licensed, Wikimedia Commons)"), have: n("SELECT COUNT(*) c FROM entity_media WHERE kind = 'venue' AND status = 'matched'"), of: n("SELECT COUNT(*) c FROM venues WHERE status = 'matched'"), note: msg("of the venues matched to Wikidata") },
        { field: msg("Career record stated by the data supplier"), have: n("SELECT COUNT(*) c FROM boxers WHERE vendor_wins IS NOT NULL"), of: boxers, note: msg("shown, labelled, when Ringside holds fewer fights than that") },
        { field: msg("Fighters whose fights Ringside holds only in part"), have: n("SELECT COUNT(*) c FROM boxers b WHERE b.vendor_wins IS NOT NULL AND (SELECT COUNT(*) FROM bouts x WHERE (x.red_id = b.id OR x.blue_id = b.id) AND x.status IS NOT 'cancelled' AND (x.winner_id IS NOT NULL OR x.method = 'DRAW')) < b.vendor_wins + b.vendor_losses + b.vendor_draws"), of: boxers, note: msg("lower is better; their pages say so") },
        { field: msg("Belt photo of the four sanctioning bodies (free-licensed)"), have: n("SELECT COUNT(*) c FROM entity_media WHERE kind = 'belt' AND status = 'matched'"), of: 4, note: msg("WBA, WBC, IBF, WBO") },
        { field: msg("Organisation logo (free-licensed)"), have: n("SELECT COUNT(*) c FROM entity_media WHERE kind = 'org_logo' AND status = 'matched'"), of: n("SELECT COUNT(*) c FROM orgs WHERE kind IN ('promotion', 'sanctioning_body', 'broadcaster')"), note: msg("promotion logos are trademarks, mostly not free") },
        { field: msg("Venue verified on Wikidata (capacity, coordinates)"), have: n("SELECT COUNT(*) c FROM events e JOIN venues v ON v.name = e.venue AND v.city = e.city AND v.status = 'matched'"), of: n("SELECT COUNT(*) c FROM events"), note: msg("fight cards") },
        { field: msg("Weigh-in weights"), have: n("SELECT COUNT(DISTINCT bout_id) c FROM weigh_ins WHERE official_lb IS NOT NULL AND " + inDone), of: done },
        { field: msg("Fight-night (pre-fight) weights"), have: n("SELECT COUNT(DISTINCT bout_id) c FROM weigh_ins WHERE fight_night_lb IS NOT NULL AND " + inDone), of: done, note: msg("few commissions record these") },
        { field: msg("Referee"), have: n("SELECT COUNT(DISTINCT bout_id) c FROM officials WHERE role='referee' AND " + inDone), of: done },
        { field: msg("Judges' scorecards"), have: n("SELECT COUNT(DISTINCT bout_id) c FROM scorecards WHERE " + inDecisions), of: decisions, note: msg("decisions only") },
        { field: msg("Corner trainers"), have: n("SELECT COUNT(DISTINCT bout_id) c FROM corners WHERE " + inDone), of: done },
        { field: msg("Round and time of stoppage"), have: n("SELECT COUNT(*) c FROM bouts WHERE method IN ('KO','TKO') AND round_time IS NOT NULL"), of: stoppages },
        { field: msg("Closing odds"), have: n("SELECT COUNT(*) c FROM bouts WHERE odds_red IS NOT NULL"), of: n("SELECT COUNT(*) c FROM bouts") },
        { field: msg("Punch statistics"), have: n("SELECT COUNT(DISTINCT bout_id) c FROM punch_stats WHERE " + inDone), of: done, note: msg("CompuBox-style; paid and partial in reality") },
      ],
    },
    {
      title: msg("Money"),
      rows: [
        { field: msg("Gate, tickets or PPV figures"), have: n("SELECT COUNT(DISTINCT event_id) c FROM event_financials"), of: n(`SELECT COUNT(*) c FROM events WHERE COALESCE(status, '') != 'cancelled' AND date <= '${todayIso()}'`), note: msg("completed cards") },
        { field: msg("Fighter purses"), have: n("SELECT COUNT(DISTINCT bout_id) c FROM purses WHERE " + inDone), of: done, note: msg("at least one fighter's purse") },
        { field: msg("Purses backed by an official record"), have: n("SELECT COUNT(*) c FROM purses WHERE basis = 'disclosed'"), of: n("SELECT COUNT(*) c FROM purses"), note: msg("rest are reported or estimated") },
        { field: msg("Broadcaster and audience"), have: n("SELECT COUNT(DISTINCT event_id) c FROM event_broadcasts"), of: n("SELECT COUNT(*) c FROM events WHERE COALESCE(status, '') != 'cancelled'") },
        { field: msg("Yearly earnings lists"), have: n("SELECT COUNT(DISTINCT boxer_id) c FROM earnings"), of: boxers },
        { field: msg("Money rows with a source link"), have: n("SELECT (SELECT COUNT(*) FROM purses WHERE source_url IS NOT NULL) + (SELECT COUNT(*) FROM event_financials WHERE source_url IS NOT NULL) + (SELECT COUNT(*) FROM event_broadcasts WHERE source_url IS NOT NULL) + (SELECT COUNT(*) FROM earnings WHERE source_url IS NOT NULL) c"), of: n("SELECT (SELECT COUNT(*) FROM purses) + (SELECT COUNT(*) FROM event_financials) + (SELECT COUNT(*) FROM event_broadcasts) + (SELECT COUNT(*) FROM earnings) c"), note: msg("so a reader can check it") },
      ],
    },
  ];
  const grp = (table: "team_stints" | "weigh_ins") => db.prepare(`SELECT source, COUNT(*) n FROM ${table} GROUP BY source ORDER BY n DESC`).all() as { source: string; n: number }[];
  const run = db.prepare("SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 1").get() as { id: number; at: string; provider: string; errors: number; warnings: number; infos: number; counts: string; dropped: string } | undefined;
  const lastRun: LastRun | null = run ? {
    at: run.at, provider: run.provider, errors: run.errors, warnings: run.warnings, infos: run.infos,
    counts: JSON.parse(run.counts), dropped: JSON.parse(run.dropped),
    issues: (db.prepare(`SELECT severity, code, COUNT(*) n, MIN(message) example FROM ingest_issues WHERE run_id = ? GROUP BY severity, code
      ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, n DESC`).all(run.id) as { severity: string; code: string; n: number; example: string }[]).map((r) => ({ ...r })),
  } : null;
  return { lastRun, groups, stintSources: grp("team_stints"), weighInSources: grp("weigh_ins"), wikidataStaged: n("SELECT COUNT(*) c FROM wikidata_boxers"), wikidataLinked: n("SELECT COUNT(*) c FROM wikidata_boxers WHERE matched_boxer_id IS NOT NULL") };
}
