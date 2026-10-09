import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FeedData } from "../feed";
import { POLICY, type GateSettings, type Table } from "./vendor-policy";

/**
 * The vendor update gate, step D1 (docs/vendor-gate-plan.md): it OBSERVES what a daily update changes in rows we already hold and says what the policy would hold for an
 * administrator. It never holds anything yet and never changes a value.
 *
 * It runs inside the update's own transaction (lib/ingest.ts calls `before` after BEGIN and `after` before COMMIT): `before` copies the rows the feed is about to touch into
 * temporary tables, `after` compares the live rows with those copies, field by field. In "observe" mode the update then commits as it always did and the report is written to
 * <data>/gate-reports/; in "report" mode (`--gate-report`) the report is printed and the transaction is rolled back, so nothing at all is written.
 */
export interface Sample { entity: string; label: string; old: unknown; new: unknown }
export interface FieldGroup {
  key: string; table: Table; column: string; rule: "wait" | "pass";
  changes: number; fills: number; replaces: number; clears: number;
  /** a change explained by a result held in the same run (career totals): carried with that result, not counted as a change of its own */
  folded: number;
  medianDelta?: number; maxDelta?: number;
  samples: Sample[];
}
export interface ResultChanges { arrived: number; changed: number; cleared: number; details: number; samples: Sample[] }
export interface RankingChanges { firstSnapshot: boolean; changed: number; removed: number; added: number; unchanged: number; samples: string[] }
export interface GateReport {
  version: 1;
  at: string;
  mode: "observe" | "report";
  /** rows the feed named that we already held, and rows it named that we did not (those go in at once) */
  touched: Record<string, number>;
  newRows: Record<string, number>;
  fields: FieldGroup[];
  results: ResultChanges;
  rankings: RankingChanges;
  /** what would wait, as the number of proposals: fields (each fighter or card field), fights with a result change, ranking lists that changed */
  wouldHold: number;
  /** what goes in without approval, by field */
  passes: Record<string, number>;
  /** rows of kinds the gate does not look at yet, from the feed (judge-level rows, money), listed so they are not forgotten */
  ungated: Record<string, number>;
  /** what the flood guard would have done, in words; empty = it would have let the night through */
  refuse: string[];
}

export class GateRollback extends Error { constructor() { super("gate report: the transaction was rolled back, nothing was written"); } }
export interface GateHooks { before(db: DatabaseSync, feed: FeedData): void; after(db: DatabaseSync, feed: FeedData): void }

const TABLES: Table[] = ["boxers", "events", "bouts", "orgs", "people"];
const SAMPLES = 10;
const RESULT_COLS = POLICY.filter((f) => f.table === "bouts" && f.group === "result").map((f) => f.column);
const isBlank = (v: unknown) => v === null || v === undefined || v === "";
const cols = (db: DatabaseSync, schema: "main" | "temp", table: string) => new Set((db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const label: Record<Table, string> = {
  boxers: "n.name", events: "n.name || ' (' || n.date || ')'", orgs: "n.name", people: "n.name",
  bouts: "COALESCE((SELECT name FROM boxers WHERE id = n.red_id), '?') || ' vs ' || COALESCE((SELECT name FROM boxers WHERE id = n.blue_id), '?') || ' (' || COALESCE((SELECT date FROM events WHERE id = n.event_id), '?') || ')'",
};
const feedIds = (feed: FeedData): Record<Table, string[]> => ({
  boxers: feed.boxers.map((x) => x.externalId), events: feed.events.map((x) => x.externalId), bouts: feed.bouts.map((x) => x.externalId),
  orgs: feed.orgs.map((x) => x.externalId), people: feed.people.map((x) => x.externalId),
});

/** Copies the rows the feed names (and the whole, small, rankings table) into temporary tables. Call it right after the update's BEGIN. */
export function snapshotBefore(db: DatabaseSync, feed: FeedData): void {
  dropSnapshot(db);
  db.exec("CREATE TEMP TABLE gate_ids (t TEXT NOT NULL, ext TEXT NOT NULL, PRIMARY KEY (t, ext)) WITHOUT ROWID");
  const ins = db.prepare("INSERT OR IGNORE INTO gate_ids (t, ext) VALUES (?, ?)");
  const ids = feedIds(feed);
  for (const t of TABLES) for (const e of ids[t]) ins.run(t, e);
  for (const t of TABLES) {
    db.exec(`CREATE TEMP TABLE gate_${t} AS SELECT n.* FROM main.${t} n JOIN gate_ids g ON g.t = '${t}' AND g.ext = n.external_id`);
    db.exec(`CREATE INDEX temp.gate_${t}_ext ON gate_${t}(external_id)`);
  }
  db.exec("CREATE TEMP TABLE gate_rankings AS SELECT * FROM main.official_rankings");
}
export function dropSnapshot(db: DatabaseSync): void {
  for (const t of ["gate_ids", ...TABLES.map((x) => `gate_${x}`), "gate_rankings"]) db.exec(`DROP TABLE IF EXISTS temp.${t}`);
}

const median = (xs: number[]) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const kindOf = (o: unknown, n: unknown): "fill" | "clear" | "replace" => (isBlank(o) && !isBlank(n) ? "fill" : !isBlank(o) && isBlank(n) ? "clear" : "replace");

/** Compares the live rows with the copies `snapshotBefore` made. Reads only. */
export function compareWithSnapshot(db: DatabaseSync, feed: FeedData, settings: GateSettings, o: { mode: "observe" | "report"; now?: Date; baseline?: boolean } = { mode: "observe" }): GateReport {
  const report: GateReport = {
    version: 1, at: (o.now ?? new Date()).toISOString(), mode: o.mode, touched: {}, newRows: {}, fields: [],
    results: { arrived: 0, changed: 0, cleared: 0, details: 0, samples: [] }, rankings: { firstSnapshot: false, changed: 0, removed: 0, added: 0, unchanged: 0, samples: [] },
    wouldHold: 0, passes: {}, ungated: {}, refuse: [],
  };
  const ids = feedIds(feed);
  for (const t of TABLES) {
    report.touched[t] = (db.prepare(`SELECT COUNT(*) c FROM temp.gate_${t}`).get() as { c: number }).c;
    report.newRows[t] = new Set(ids[t]).size - report.touched[t];
  }
  report.ungated = {
    "judge-level scorecards": feed.scorecards.length, officials: feed.officials.length, corners: feed.corners.length, "punch stats": feed.punches.length, "weigh-ins": feed.weighIns.length,
    "team stints": feed.stints.length, "financials, purses, broadcasts, earnings": feed.financials.length + feed.purses.length + feed.broadcasts.length + feed.earnings.length,
  };

  // fights whose result moved, found first: the fighters in them explain their own totals
  const resultFights = new Set<number>();
  const boutCols = cols(db, "main", "bouts"), snapBout = cols(db, "temp", "gate_bouts");
  const rc = RESULT_COLS.filter((c) => boutCols.has(c) && snapBout.has(c));
  const explained = new Set<number>(); // boxer ids with a result change this run
  if (rc.length) {
    const rows = db.prepare(`SELECT n.id id, n.external_id e, n.red_id r, n.blue_id u, ${label.bouts} lbl, ${rc.map((c) => `o.${q(c)} o_${c}, n.${q(c)} n_${c}`).join(", ")},
        (SELECT name FROM boxers WHERE id = o.winner_id) ow, (SELECT name FROM boxers WHERE id = n.winner_id) nw
      FROM main.bouts n JOIN temp.gate_bouts o ON o.external_id = n.external_id WHERE ${rc.map((c) => `o.${q(c)} IS NOT n.${q(c)}`).join(" OR ")}`).all() as Record<string, unknown>[];
    for (const r of rows) {
      const hadResult = !isBlank(r.o_method), hasResult = !isBlank(r.n_method);
      const methodMoved = ["winner_id", "method", "end_round"].some((c) => r[`o_${c}`] !== r[`n_${c}`]);
      let kind: "arrived" | "changed" | "cleared" | "details";
      if (!hadResult && hasResult) kind = "arrived"; else if (hadResult && !hasResult) kind = "cleared"; else if (methodMoved) kind = "changed"; else kind = "details";
      report.results[kind]++;
      if (kind !== "details") { explained.add(r.r as number); explained.add(r.u as number); }
      resultFights.add(r.id as number);
      if (report.results.samples.length < SAMPLES) {
        const side = (w: unknown, m: unknown, e: unknown) => (isBlank(m) ? "no result" : `${isBlank(w) ? "no winner" : w} by ${m}${isBlank(e) ? "" : ` in round ${e}`}`);
        report.results.samples.push({ entity: `bouts ${kind}`, label: r.lbl as string, old: side(r.ow, r.o_method, r.o_end_round), new: side(r.nw, r.n_method, r.n_end_round) });
      }
    }
  }

  // every other gated or passing field, one group per column
  for (const f of POLICY) {
    if (f.group === "result") continue;
    const live = cols(db, "main", f.table), snap = cols(db, "temp", `gate_${f.table}`);
    if (!live.has(f.column) || !snap.has(f.column)) continue;
    const idCol = f.table === "boxers" ? ", n.id id" : "";
    const rows = db.prepare(`SELECT n.external_id e${idCol}, ${label[f.table]} lbl, o.${q(f.column)} ov, n.${q(f.column)} nv FROM main.${f.table} n JOIN temp.gate_${f.table} o ON o.external_id = n.external_id WHERE o.${q(f.column)} IS NOT n.${q(f.column)}`).all() as { e: string; id?: number; lbl: string; ov: unknown; nv: unknown }[];
    const key = `${f.table}.${f.column}`;
    const g: FieldGroup = { key, table: f.table, column: f.column, rule: f.rule, changes: 0, fills: 0, replaces: 0, clears: 0, folded: 0, samples: [] };
    const deltas: number[] = [];
    for (const r of rows) {
      if (f.passIf?.(r.ov, r.nv)) { report.passes[key] = (report.passes[key] ?? 0) + 1; continue; }
      if (f.rule === "pass") { report.passes[key] = (report.passes[key] ?? 0) + 1; continue; }
      if (f.group === "totals" && r.id !== undefined && explained.has(r.id)) { g.folded++; continue; }
      g.changes++;
      const k = kindOf(r.ov, r.nv); if (k === "fill") g.fills++; else if (k === "clear") g.clears++; else g.replaces++;
      if (f.numeric && typeof r.ov === "number" && typeof r.nv === "number") deltas.push(Math.abs(r.nv - r.ov));
      if (g.samples.length < SAMPLES) g.samples.push({ entity: r.e, label: r.lbl, old: r.ov, new: r.nv });
    }
    if (deltas.length) { g.medianDelta = median(deltas); g.maxDelta = Math.max(...deltas); }
    if (f.rule === "wait" && (g.changes || g.folded)) report.fields.push(g);
  }
  report.fields.sort((a, b) => b.changes - a.changes || a.key.localeCompare(b.key));

  // official rankings: one proposal per list that differs
  const sig = (table: string) => {
    const lists = new Map<string, string>();
    const rows = db.prepare(`SELECT body, division, sex, kind, rank, boxer_id, name, title_type, vacant FROM ${table} ORDER BY body, division, sex, position, rank`).all() as Record<string, unknown>[];
    const by = new Map<string, unknown[]>();
    for (const r of rows) { const k = `${r.body}|${r.division}|${r.sex}`; (by.get(k) ?? by.set(k, []).get(k)!).push([r.kind, r.rank, r.boxer_id, r.name, r.title_type, r.vacant]); }
    for (const [k, v] of by) lists.set(k, JSON.stringify(v));
    return lists;
  };
  const oldL = sig("temp.gate_rankings"), newL = sig("main.official_rankings");
  if (oldL.size === 0) { report.rankings.firstSnapshot = newL.size > 0; report.rankings.added = newL.size; }
  else for (const k of new Set([...oldL.keys(), ...newL.keys()])) {
    const a = oldL.get(k), b = newL.get(k);
    if (a === b) report.rankings.unchanged++;
    else if (a === undefined) report.rankings.added++;
    else if (b === undefined) { report.rankings.removed++; if (report.rankings.samples.length < SAMPLES) report.rankings.samples.push(`${k.replace(/\|/g, " ")}: list gone`); }
    else { report.rankings.changed++; if (report.rankings.samples.length < SAMPLES) report.rankings.samples.push(`${k.replace(/\|/g, " ")}: list changed`); }
  }

  const resultsHeld = report.results.arrived + report.results.changed + report.results.cleared + report.results.details;
  report.wouldHold = report.fields.reduce((n, f) => n + f.changes, 0) + resultsHeld + report.rankings.changed + report.rankings.removed;

  // what the flood guard would say (it does not apply to the first, baseline night)
  if (!o.baseline) {
    for (const f of report.fields) {
      const rows = report.touched[f.table] || 1, share = f.changes / rows;
      if (f.changes >= settings.maxFieldRows && share > settings.maxFieldShare) report.refuse.push(`${f.key} changes in ${f.changes} of the ${rows} ${f.table} the feed touched (${Math.round(share * 100)}%; the limit is ${Math.round(settings.maxFieldShare * 100)}% with at least ${settings.maxFieldRows}): a changed format, not boxing`);
    }
    if (report.wouldHold > settings.maxNight) report.refuse.push(`${report.wouldHold} changes in one night is more than the ceiling of ${settings.maxNight}`);
  }
  return report;
}

export function describeGateReport(r: GateReport): string[] {
  const out: string[] = [];
  const nums = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(", ") || "none";
  out.push(`vendor gate (${r.mode}): the feed named ${nums(r.touched)} we already hold, and ${nums(r.newRows)} new (those go in at once).`);
  out.push(`  would wait for an administrator: ${r.wouldHold} change(s)${r.wouldHold ? "" : " (none)"}`);
  const res = r.results;
  if (res.arrived + res.changed + res.cleared + res.details) out.push(`  fights with a result change: ${res.arrived} result(s) arriving, ${res.changed} changed, ${res.cleared} removed, ${res.details} other detail(s) of a result`);
  for (const s of res.samples.slice(0, 5)) out.push(`      ${s.label}: ${s.old} -> ${s.new}`);
  for (const f of r.fields) {
    const delta = f.medianDelta !== undefined ? `, median change ${f.medianDelta}, largest ${f.maxDelta}` : "";
    out.push(`  ${f.key}: ${f.changes} (${f.fills} filled, ${f.replaces} replaced, ${f.clears} cleared)${f.folded ? `, ${f.folded} more folded into a result` : ""}${delta}`);
    for (const s of f.samples.slice(0, 3)) out.push(`      ${s.label}: ${JSON.stringify(s.old)} -> ${JSON.stringify(s.new)}`);
  }
  const rk = r.rankings;
  if (rk.firstSnapshot) out.push(`  official rankings: the first snapshot (${rk.added} list(s)) goes in whole`);
  else if (rk.changed + rk.removed + rk.added > 0) out.push(`  official rankings: ${rk.changed} list(s) changed, ${rk.removed} gone, ${rk.added} new, ${rk.unchanged} unchanged`);
  const pass = Object.entries(r.passes).sort(([, a], [, b]) => b - a);
  if (pass.length) out.push(`  go in without approval: ${pass.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const ug = Object.entries(r.ungated).filter(([, v]) => v > 0);
  if (ug.length) out.push(`  not gated (listed, not held): ${ug.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  out.push(r.refuse.length ? `  THE FLOOD GUARD WOULD REFUSE THIS NIGHT:\n    - ${r.refuse.join("\n    - ")}` : "  the flood guard would let this night through");
  return out;
}

/** Writes the report to <dir>/gate-reports/<time>.json and keeps the newest 90. Returns the file, or null if it could not be written (observing never stops an update). */
export function writeGateReport(dir: string, r: GateReport): string | null {
  try {
    const folder = path.join(dir, "gate-reports");
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${r.at.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(r, null, 1));
    for (const old of fs.readdirSync(folder).filter((n) => n.endsWith(".json")).sort().slice(0, -90)) fs.rmSync(path.join(folder, old), { force: true });
    return file;
  } catch { return null; }
}

export interface HookOptions { mode: "observe" | "report"; settings: GateSettings; log: (m: string) => void; dataDir?: string; baseline?: boolean; now?: () => Date }
/**
 * The hooks `ingest` calls. Observe: the update goes on and commits exactly as before; anything wrong in here is logged and never stops it.
 * Report: the report is printed and the update is rolled back (GateRollback), so nothing is written.
 */
export function gateHooks(o: HookOptions): GateHooks & { last: () => GateReport | null } {
  let last: GateReport | null = null, ready = false;
  return {
    last: () => last,
    before(db, feed) {
      if (o.mode === "report") { snapshotBefore(db, feed); ready = true; return; }
      try { snapshotBefore(db, feed); ready = true; } catch (e) { ready = false; o.log(`vendor gate: could not observe this update (${(e as Error).message}); the update goes on`); }
    },
    after(db, feed) {
      if (!ready) return;
      if (o.mode === "observe") {
        try {
          last = compareWithSnapshot(db, feed, o.settings, { mode: "observe", now: o.now?.(), baseline: o.baseline });
          dropSnapshot(db);
          for (const l of describeGateReport(last)) o.log(l);
          const file = o.dataDir ? writeGateReport(o.dataDir, last) : null;
          if (file) o.log(`vendor gate: the report is in ${path.relative(process.cwd(), file) || file}`);
        } catch (e) { o.log(`vendor gate: could not observe this update (${(e as Error).message}); the update goes on`); try { dropSnapshot(db); } catch { /* the transaction will end the same way */ } }
        return;
      }
      last = compareWithSnapshot(db, feed, o.settings, { mode: "report", now: o.now?.(), baseline: o.baseline });
      for (const l of describeGateReport(last)) o.log(l);
      throw new GateRollback();
    },
  };
}
