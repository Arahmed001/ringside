import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FeedData } from "../feed";
import { POLICY, TABLE_OF, type GateSettings, type Table } from "./vendor-policy";
export { TABLE_OF };
import { reconcile } from "./proposals";
import { applyRules, recordRuleUse, type Rule, type RuleUse } from "./rules";
import type { Change } from "./types";

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
  mode: "observe" | "report" | "hold";
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
  /** changes that a standing rule accepted, so they stayed (hold mode only) */
  acceptedByRule: { field: string; condition: string; amount: number | null; count: number }[];
}

export class GateRollback extends Error { constructor() { super("gate report: the transaction was rolled back, nothing was written"); } }
/** The night would be refused by the flood guard (exit 3, nothing written): the usual cause is a changed format at the vendor, not boxing news. */
export class GateRefusal extends Error { constructor(public reasons: string[]) { super(`the vendor update gate refused this night, and nothing was written: ${reasons.join("; ")}`); } }
export interface GateHooks { before(db: DatabaseSync, feed: FeedData): void; after(db: DatabaseSync, feed: FeedData): void }

// ---- the full list of changes (the report summarises it; holding restores it and turns it into proposals) -------------------------------------------

export type Kind = "fill" | "clear" | "replace";
export interface FieldChange { table: Table; ext: string; id?: number; column: string; label: string; old: unknown; new: unknown; kind: Kind; shown?: { old: string | null; new: string | null } }
export interface TotalsChange { boxerExt: string; name: string; old: Record<string, unknown>; new: Record<string, unknown> }
export interface ResultChange {
  ext: string; id: number; label: string; kind: "arrived" | "changed" | "cleared" | "details";
  old: Record<string, unknown>; new: Record<string, unknown>; shown: { old: string; new: string };
  /** the fighters' career totals that this result explains: carried with it, applied with it */
  totals: TotalsChange[];
}
export interface ListRow { kind: string; rank: number | null; boxer_id: number | null; name: string | null; title_type: string | null; vacant: number; updated_at: string | null; position: number; who?: string | null }
export interface ListChange { key: string; kind: "changed" | "removed"; oldRows: ListRow[]; newRows: ListRow[] }
export interface ChangeSet {
  fields: FieldChange[];
  /** totals changes that ride with a result (counted, not held on their own) */
  folded: FieldChange[];
  results: ResultChange[];
  lists: ListChange[];
  passes: Record<string, number>;
  touched: Record<string, number>; newRows: Record<string, number>;
  rankings: { firstSnapshot: boolean; added: number; unchanged: number };
}

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
const kindOf = (o: unknown, n: unknown): Kind => (isBlank(o) && !isBlank(n) ? "fill" : !isBlank(o) && isBlank(n) ? "clear" : "replace");
const SINGULAR: Record<Table, string> = { boxers: "boxer", events: "event", bouts: "bout", orgs: "org", people: "person" };
const FK_NAME: Record<string, string> = { "events.promoter_org_id": "orgs", "bouts.title_org_id": "orgs", "bouts.winner_id": "boxers" };

/** Reads what the update changed in rows we already held. Reads only. */
export function collectChanges(db: DatabaseSync, feed: FeedData): ChangeSet {
  const cs: ChangeSet = { fields: [], folded: [], results: [], lists: [], passes: {}, touched: {}, newRows: {}, rankings: { firstSnapshot: false, added: 0, unchanged: 0 } };
  const ids = feedIds(feed);
  for (const t of TABLES) {
    cs.touched[t] = (db.prepare(`SELECT COUNT(*) c FROM temp.gate_${t}`).get() as { c: number }).c;
    cs.newRows[t] = new Set(ids[t]).size - cs.touched[t];
  }
  const nameOf = (table: string, id: unknown) => (typeof id === "number" ? ((db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined)?.name ?? null) : null);
  const pass = (key: string, n = 1) => { cs.passes[key] = (cs.passes[key] ?? 0) + n; };

  // fights that are NEW in this feed: their fighters' totals move with them and go in at once
  const inNewFight = new Set<number>();
  for (const r of db.prepare("SELECT n.red_id r, n.blue_id u FROM main.bouts n JOIN temp.gate_ids g ON g.t = 'bouts' AND g.ext = n.external_id WHERE NOT EXISTS (SELECT 1 FROM temp.gate_bouts o WHERE o.external_id = n.external_id)").all() as { r: number; u: number }[]) { inNewFight.add(r.r); inNewFight.add(r.u); }

  // fights whose result moved, found first: the fighters in them explain their own totals
  const boutCols = cols(db, "main", "bouts"), snapBout = cols(db, "temp", "gate_bouts");
  const rc = RESULT_COLS.filter((c) => boutCols.has(c) && snapBout.has(c));
  const byFighter = new Map<number, ResultChange[]>(); // boxer id -> the result changes (that are not mere details) they are in
  if (rc.length) {
    const rows = db.prepare(`SELECT n.id id, n.external_id e, n.red_id r, n.blue_id u, ${label.bouts} lbl, ${rc.map((c) => `o.${q(c)} o_${c}, n.${q(c)} n_${c}`).join(", ")}
      FROM main.bouts n JOIN temp.gate_bouts o ON o.external_id = n.external_id WHERE ${rc.map((c) => `o.${q(c)} IS NOT n.${q(c)}`).join(" OR ")} ORDER BY n.external_id`).all() as Record<string, unknown>[];
    for (const r of rows) {
      const hadResult = !isBlank(r.o_method), hasResult = !isBlank(r.n_method);
      const methodMoved = ["winner_id", "method", "end_round"].some((c) => r[`o_${c}`] !== r[`n_${c}`]);
      const kind = !hadResult && hasResult ? "arrived" : hadResult && !hasResult ? "cleared" : methodMoved ? "changed" : "details";
      const side = (w: unknown, m: unknown, e: unknown) => (isBlank(m) ? "no result" : `${isBlank(w) ? "no winner" : nameOf("boxers", w)} by ${m}${isBlank(e) ? "" : ` in round ${e}`}`);
      const rcg: ResultChange = {
        ext: r.e as string, id: r.id as number, label: r.lbl as string, kind,
        old: Object.fromEntries(rc.map((c) => [c, r[`o_${c}`]])), new: Object.fromEntries(rc.map((c) => [c, r[`n_${c}`]])),
        shown: { old: side(r.o_winner_id, r.o_method, r.o_end_round), new: side(r.n_winner_id, r.n_method, r.n_end_round) }, totals: [],
      };
      cs.results.push(rcg);
      if (kind !== "details") for (const f of [r.r as number, r.u as number]) (byFighter.get(f) ?? byFighter.set(f, []).get(f)!).push(rcg);
    }
  }

  // every other field, one query per column
  const totalsByBoxer = new Map<number, { change: TotalsChange; fields: FieldChange[] }>();
  for (const f of POLICY) {
    if (f.group === "result") continue;
    const live = cols(db, "main", f.table), snap = cols(db, "temp", `gate_${f.table}`);
    if (!live.has(f.column) || !snap.has(f.column)) continue;
    const rows = db.prepare(`SELECT n.external_id e, n.id id, ${label[f.table]} lbl, o.${q(f.column)} ov, n.${q(f.column)} nv FROM main.${f.table} n JOIN temp.gate_${f.table} o ON o.external_id = n.external_id WHERE o.${q(f.column)} IS NOT n.${q(f.column)} ORDER BY n.external_id`).all() as { e: string; id: number; lbl: string; ov: unknown; nv: unknown }[];
    const key = `${f.table}.${f.column}`;
    for (const r of rows) {
      if (f.rule === "pass" || f.passIf?.(r.ov, r.nv)) { pass(key); continue; }
      const fk = FK_NAME[key];
      const ch: FieldChange = { table: f.table, ext: r.e, id: r.id, column: f.column, label: r.lbl, old: r.ov, new: r.nv, kind: kindOf(r.ov, r.nv), ...(fk ? { shown: { old: nameOf(fk, r.ov), new: nameOf(fk, r.nv) } } : {}) };
      if (f.group === "totals" && f.table === "boxers") {
        if (inNewFight.has(r.id)) { pass("boxers.totals (with a new fight)"); continue; }
        const mine = byFighter.get(r.id);
        if (mine?.length) {
          const t = totalsByBoxer.get(r.id) ?? (() => { const x = { change: { boxerExt: r.e, name: r.lbl, old: {}, new: {} } as TotalsChange, fields: [] as FieldChange[] }; totalsByBoxer.set(r.id, x); return x; })();
          t.change.old[f.column] = r.ov; t.change.new[f.column] = r.nv; t.fields.push(ch);
          continue;
        }
      }
      cs.fields.push(ch);
    }
  }
  for (const [boxerId, t] of totalsByBoxer) { // the fighter's totals go with the first of their result changes, by fight id
    const target = [...byFighter.get(boxerId)!].sort((a, b) => a.ext.localeCompare(b.ext))[0];
    target.totals.push(t.change); cs.folded.push(...t.fields);
  }

  // official rankings: one list is one change
  const readLists = (table: string) => {
    const rows = db.prepare(`SELECT kind, rank, boxer_id, name, title_type, vacant, updated_at, position, body, division, sex FROM ${table} ORDER BY body, division, sex, position, rank`).all() as unknown as (ListRow & { body: string; division: string; sex: string })[];
    const by = new Map<string, ListRow[]>();
    for (const r of rows) { const k = `${r.body}|${r.division}|${r.sex}`; const { body: _b, division: _d, sex: _s, ...rest } = r; void _b; void _d; void _s; (by.get(k) ?? by.set(k, []).get(k)!).push(rest); }
    return by;
  };
  const sig = (rows: ListRow[] | undefined) => JSON.stringify((rows ?? []).map((r) => [r.kind, r.rank, r.boxer_id, r.name, r.title_type, r.vacant]));
  const oldL = readLists("temp.gate_rankings"), newL = readLists("main.official_rankings");
  if (oldL.size === 0) { cs.rankings.firstSnapshot = newL.size > 0; cs.rankings.added = newL.size; }
  else for (const k of new Set([...oldL.keys(), ...newL.keys()])) {
    const a = oldL.get(k), b = newL.get(k);
    if (a && b && sig(a) === sig(b)) cs.rankings.unchanged++;
    else if (!a) cs.rankings.added++; // a list we did not have: new data, goes in
    else {
      const who = (rows: ListRow[]) => rows.map((r) => ({ ...r, who: r.name ?? nameOf("boxers", r.boxer_id) }));
      cs.lists.push({ key: k, kind: b ? "changed" : "removed", oldRows: who(a), newRows: who(b ?? []) });
    }
  }
  return cs;
}

/** The report (and the flood guard's verdict) for a set of changes. */
export function buildReport(cs: ChangeSet, feed: FeedData, settings: GateSettings, o: { mode: "observe" | "report" | "hold"; now?: Date; baseline?: boolean }): GateReport {
  const report: GateReport = {
    version: 1, at: (o.now ?? new Date()).toISOString(), mode: o.mode, touched: cs.touched, newRows: cs.newRows, fields: [],
    results: { arrived: 0, changed: 0, cleared: 0, details: 0, samples: [] }, rankings: { firstSnapshot: cs.rankings.firstSnapshot, changed: 0, removed: 0, added: cs.rankings.added, unchanged: cs.rankings.unchanged, samples: [] },
    wouldHold: 0, passes: cs.passes, ungated: {}, refuse: [], acceptedByRule: [],
  };
  report.ungated = {
    "judge-level scorecards": feed.scorecards.length, officials: feed.officials.length, corners: feed.corners.length, "punch stats": feed.punches.length, "weigh-ins": feed.weighIns.length,
    "team stints": feed.stints.length, "financials, purses, broadcasts, earnings": feed.financials.length + feed.purses.length + feed.broadcasts.length + feed.earnings.length,
  };
  for (const r of cs.results) {
    report.results[r.kind]++;
    if (report.results.samples.length < SAMPLES) report.results.samples.push({ entity: `bouts ${r.kind}`, label: r.label, old: r.shown.old, new: r.shown.new });
  }
  const groups = new Map<string, FieldGroup>();
  const group = (c: FieldChange) => groups.get(`${c.table}.${c.column}`) ?? (() => { const g: FieldGroup = { key: `${c.table}.${c.column}`, table: c.table, column: c.column, rule: "wait", changes: 0, fills: 0, replaces: 0, clears: 0, folded: 0, samples: [] }; groups.set(g.key, g); return g; })();
  const deltas = new Map<string, number[]>();
  for (const c of cs.fields) {
    const g = group(c); g.changes++;
    if (c.kind === "fill") g.fills++; else if (c.kind === "clear") g.clears++; else g.replaces++;
    if (policyNumeric(c) && typeof c.old === "number" && typeof c.new === "number") (deltas.get(g.key) ?? deltas.set(g.key, []).get(g.key)!).push(Math.abs(c.new - c.old));
    if (g.samples.length < SAMPLES) g.samples.push({ entity: c.ext, label: c.label, old: c.old, new: c.new });
  }
  for (const c of cs.folded) group(c).folded++;
  for (const [k, d] of deltas) { const g = groups.get(k)!; g.medianDelta = median(d); g.maxDelta = Math.max(...d); }
  report.fields = [...groups.values()].sort((a, b) => b.changes - a.changes || a.key.localeCompare(b.key));
  for (const l of cs.lists) { report.rankings[l.kind === "removed" ? "removed" : "changed"]++; if (report.rankings.samples.length < SAMPLES) report.rankings.samples.push(`${l.key.replace(/\|/g, " ")}: list ${l.kind === "removed" ? "gone" : "changed"}`); }
  report.wouldHold = cs.fields.length + cs.results.length + cs.lists.length;
  if (!o.baseline) {
    for (const f of report.fields) {
      const rows = report.touched[f.table] || 1, share = f.changes / rows;
      if (f.changes >= settings.maxFieldRows && share > settings.maxFieldShare) report.refuse.push(`${f.key} changes in ${f.changes} of the ${rows} ${f.table} the feed touched (${Math.round(share * 100)}%; the limit is ${Math.round(settings.maxFieldShare * 100)}% with at least ${settings.maxFieldRows}): a changed format, not boxing`);
    }
    if (report.wouldHold > settings.maxNight) report.refuse.push(`${report.wouldHold} changes in one night is more than the ceiling of ${settings.maxNight}`);
  }
  return report;
}
const policyNumeric = (c: FieldChange) => !!POLICY.find((f) => f.table === c.table && f.column === c.column)?.numeric;

/** Compares the live rows with the copies `snapshotBefore` made. Reads only. */
export function compareWithSnapshot(db: DatabaseSync, feed: FeedData, settings: GateSettings, o: { mode: "observe" | "report" | "hold"; now?: Date; baseline?: boolean } = { mode: "observe" }): GateReport {
  return buildReport(collectChanges(db, feed), feed, settings, o);
}

// ---- holding: put the old values back, and say what was held -------------------------------------------------------------------------------------

/** Writes the old value back for everything in the change set. Call it inside the update's transaction, after the writes. */
export function restoreHeld(db: DatabaseSync, cs: ChangeSet): void {
  const byCol = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  const set = (table: string, col: string) => byCol.get(`${table}.${col}`) ?? (() => { const st = db.prepare(`UPDATE ${table} SET ${q(col)} = ? WHERE external_id = ?`); byCol.set(`${table}.${col}`, st); return st; })();
  for (const c of [...cs.fields, ...cs.folded]) set(c.table, c.column).run(c.old as never, c.ext);
  for (const r of cs.results) {
    const cols2 = Object.keys(r.old);
    db.prepare(`UPDATE bouts SET ${cols2.map((c) => `${q(c)} = ?`).join(", ")} WHERE external_id = ?`).run(...(cols2.map((c) => r.old[c]) as never[]), r.ext);
  }
  const del = db.prepare("DELETE FROM official_rankings WHERE body = ? AND division = ? AND sex = ?");
  const ins = db.prepare("INSERT INTO official_rankings (body, division, sex, kind, rank, boxer_id, name, title_type, vacant, updated_at, position) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const l of cs.lists) {
    const [body, division, sex] = l.key.split("|");
    del.run(body, division, sex);
    for (const r of l.oldRows) ins.run(body, division, sex, r.kind, r.rank, r.boxer_id, r.name, r.title_type, r.vacant, r.updated_at, r.position);
  }
}

/** The held changes as proposals (lib/watch/proposals.ts `reconcile` stores them). One per field, one per fight's result, one per ranking list. */
export function toProposalChanges(cs: ChangeSet): Change[] {
  const out: Change[] = [];
  for (const c of cs.fields) out.push({ kind: "field_change", targetKey: `${SINGULAR[c.table]}|${c.ext}|${c.column}`, label: `${c.label}: ${c.column}`, old: { [c.column]: c.old }, new: { [c.column]: c.new }, evidence: { column: c.column, change: c.kind, ...(c.shown ? { shown: c.shown } : {}) } });
  for (const r of cs.results) out.push({ kind: "result_change", targetKey: `bout|${r.ext}|result`, label: `${r.label}: ${r.kind === "arrived" ? "result" : r.kind === "cleared" ? "result removed" : r.kind === "changed" ? "result changed" : "result details"}`, old: r.old, new: r.new, evidence: { change: r.kind, shown: r.shown, totals: r.totals } });
  for (const l of cs.lists) out.push({ kind: "list_change", targetKey: `list|${l.key}`, label: `Official ranking ${l.key.replace(/\|/g, " ")}: ${l.kind === "removed" ? "list gone" : "list changed"}`, old: { rows: l.oldRows }, new: { rows: l.newRows }, evidence: { change: l.kind } });
  return out;
}

export function describeGateReport(r: GateReport): string[] {
  const out: string[] = [];
  const nums = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(", ") || "none";
  out.push(`vendor gate (${r.mode}): the feed named ${nums(r.touched)} we already hold, and ${nums(r.newRows)} new (those go in at once).`);
  out.push(`  ${r.mode === "hold" ? "held for an administrator" : "would wait for an administrator"}: ${r.wouldHold} change(s)${r.wouldHold ? "" : " (none)"}`);
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
  out.push(r.refuse.length ? `  THE FLOOD GUARD ${r.mode === "hold" ? "REFUSES" : "WOULD REFUSE"} THIS NIGHT:\n    - ${r.refuse.join("\n    - ")}` : "  the flood guard lets this night through");
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

/** True once this data folder has had a night of holding (a report written by hold mode exists): from then on the flood guard applies. */
export function hasHeldBefore(dir: string): boolean {
  try {
    const folder = path.join(dir, "gate-reports");
    return fs.readdirSync(folder).filter((n) => n.endsWith(".json")).some((n) => { try { return (JSON.parse(fs.readFileSync(path.join(folder, n), "utf8")) as { mode?: string }).mode === "hold"; } catch { return false; } });
  } catch { return false; }
}

export const VENDOR_SOURCE_ID = "vendor:boxing-data-api";
export interface HookOptions { mode: "observe" | "report" | "hold"; rules?: Rule[]; settings: GateSettings; log: (m: string) => void; dataDir?: string; baseline?: boolean; now?: () => Date }
/**
 * The hooks `ingest` calls.
 *  - observe: the update goes on and commits exactly as before; anything wrong in here is logged and never stops it.
 *  - report: the report is printed and the update is rolled back (GateRollback), so nothing is written.
 *  - hold: the changes the policy says must wait are PUT BACK before the commit (so no page can show them) and become proposals (`flush`, after the commit). The flood guard
 *    can refuse the night (GateRefusal, rolled back, nothing written). A bug in here stops the update and rolls it back: unlike observing, holding must never half-work.
 */
export function gateHooks(o: HookOptions): GateHooks & { last: () => GateReport | null; flush: (acc: DatabaseSync) => { held: number; added: number; updated: number; unchanged: number; remembered: number; superseded: number } | null } {
  let last: GateReport | null = null, ready = false, held: ChangeSet | null = null, fed: FeedData | null = null, ruleUses: RuleUse[] = [];
  return {
    last: () => last,
    before(db, feed) {
      fed = feed;
      if (o.mode !== "observe") { snapshotBefore(db, feed); ready = true; return; }
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
      const cs = collectChanges(db, feed);
      last = buildReport(cs, feed, o.settings, { mode: o.mode, now: o.now?.(), baseline: o.baseline });
      for (const l of describeGateReport(last)) o.log(l);
      if (o.mode === "report") throw new GateRollback();
      if (last.refuse.length) throw new GateRefusal(last.refuse); // the guard looks at the whole night, before any standing rule
      const ruled = applyRules(cs, o.rules ?? []);
      ruleUses = ruled.uses;
      const accepted = ruled.uses.reduce((n, u) => n + u.count, 0);
      if (accepted) {
        last.wouldHold -= accepted;
        last.acceptedByRule = ruled.uses.map((u) => ({ field: u.rule.field, condition: u.rule.condition, amount: u.rule.amount, count: u.count }));
        o.log(`  accepted by standing rule, so not held: ${last.acceptedByRule.map((a) => `${a.field} ${a.condition === "max_delta" ? `within ${a.amount}` : a.condition}: ${a.count}`).join("; ")}`);
      }
      restoreHeld(db, ruled.held);
      dropSnapshot(db);
      held = ruled.held;
      const file = o.dataDir ? writeGateReport(o.dataDir, last) : null;
      if (file) o.log(`vendor gate: the report is in ${path.relative(process.cwd(), file) || file}`);
    },
    /** After the update has committed: store the held changes as proposals for an administrator. Safe to call when nothing was held. */
    flush(acc) {
      if (o.mode !== "hold" || !held || !fed) return null;
      const feed = fed;
      const prefixes = new Set<string>();
      for (const t of TABLES) for (const e of feedIds(feed)[t]) prefixes.add(`${SINGULAR[t]}|${e}`);
      const listsToo = feed.officialRankings.length > 0;
      const inScope = (key: string) => (key.startsWith("list|") ? listsToo : prefixes.has(key.split("|").slice(0, 2).join("|")));
      const r = reconcile(acc, VENDOR_SOURCE_ID, toProposalChanges(held), inScope, o.now?.().toISOString());
      recordRuleUse(acc, ruleUses, o.now?.().toISOString());
      return { held: held.fields.length + held.results.length + held.lists.length, ...r };
    },
  };
}
