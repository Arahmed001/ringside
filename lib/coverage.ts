import { getDb } from "./db";

export interface CoverageRow { field: string; have: number; of: number; note?: string }
export interface CoverageGroup { title: string; rows: CoverageRow[] }

/** Live field-by-field completeness, straight from the database. */
export interface LastRun {
  at: string; provider: string; errors: number; warnings: number; infos: number;
  counts: Record<string, number>; dropped: Record<string, number>;
  issues: { severity: string; code: string; n: number; example: string }[];
}

export async function coverage(): Promise<{ lastRun: LastRun | null; groups: CoverageGroup[]; stintSources: { source: string; n: number }[]; weighInSources: { source: string; n: number }[]; wikidataStaged: number; wikidataLinked: number }> {
  const db = await getDb();
  const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const boxers = n("SELECT COUNT(*) c FROM boxers");
  const done = n("SELECT COUNT(*) c FROM bouts WHERE method IS NOT NULL");
  const decisions = n("SELECT COUNT(*) c FROM bouts WHERE method IN ('UD','SD','MD','DRAW')");
  const stoppages = n("SELECT COUNT(*) c FROM bouts WHERE method IN ('KO','TKO')");
  const activeBoxers = n("SELECT COUNT(*) c FROM boxers WHERE active = 1");
  const groups: CoverageGroup[] = [
    {
      title: "Fighters",
      rows: [
        { field: "Exact birth date", have: n("SELECT COUNT(*) c FROM boxers WHERE birth_date IS NOT NULL"), of: boxers },
        { field: "Birthplace", have: n("SELECT COUNT(*) c FROM boxers WHERE birth_place IS NOT NULL"), of: boxers },
        { field: "Residence", have: n("SELECT COUNT(*) c FROM boxers WHERE residence IS NOT NULL"), of: boxers },
        { field: "Wikidata link", have: n("SELECT COUNT(*) c FROM boxers WHERE wikidata_id IS NOT NULL"), of: boxers },
        { field: "BoxRec ID (cross-reference only)", have: n("SELECT COUNT(*) c FROM boxers WHERE boxrec_id IS NOT NULL"), of: boxers },
        { field: "Photo (licensed or Wikimedia)", have: n("SELECT COUNT(*) c FROM boxers WHERE photo_url IS NOT NULL"), of: boxers, note: "otherwise a generated portrait" },
        { field: "Current head trainer", have: n("SELECT COUNT(DISTINCT boxer_id) c FROM team_stints WHERE role='head_trainer' AND end_date IS NULL"), of: activeBoxers, note: "active fighters" },
        { field: "Current manager", have: n("SELECT COUNT(DISTINCT boxer_id) c FROM team_stints WHERE role='manager' AND end_date IS NULL"), of: activeBoxers, note: "active fighters" },
        { field: "Trainer history (2+ trainers on record)", have: n("SELECT COUNT(*) c FROM (SELECT boxer_id FROM team_stints WHERE role='head_trainer' GROUP BY boxer_id HAVING COUNT(*) >= 2)"), of: boxers },
      ],
    },
    {
      title: "Bouts",
      rows: [
        { field: "Weigh-in weights", have: n("SELECT COUNT(DISTINCT bout_id) c FROM weigh_ins WHERE official_lb IS NOT NULL"), of: done },
        { field: "Fight-night (pre-fight) weights", have: n("SELECT COUNT(DISTINCT bout_id) c FROM weigh_ins WHERE fight_night_lb IS NOT NULL"), of: done, note: "few commissions record these" },
        { field: "Referee", have: n("SELECT COUNT(DISTINCT bout_id) c FROM officials WHERE role='referee'"), of: done },
        { field: "Judges' scorecards", have: n("SELECT COUNT(DISTINCT bout_id) c FROM scorecards"), of: decisions, note: "decisions only" },
        { field: "Corner trainers", have: n("SELECT COUNT(DISTINCT bout_id) c FROM corners"), of: done },
        { field: "Round and time of stoppage", have: n("SELECT COUNT(*) c FROM bouts WHERE method IN ('KO','TKO') AND round_time IS NOT NULL"), of: stoppages },
        { field: "Closing odds", have: n("SELECT COUNT(*) c FROM bouts WHERE odds_red IS NOT NULL"), of: n("SELECT COUNT(*) c FROM bouts") },
        { field: "Punch statistics", have: n("SELECT COUNT(DISTINCT bout_id) c FROM punch_stats"), of: done, note: "CompuBox-style; paid and partial in reality" },
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
