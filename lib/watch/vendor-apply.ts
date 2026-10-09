import type { DatabaseSync } from "node:sqlite";
import { POLICY, type Table } from "./vendor-policy";
import { TABLE_OF, VENDOR_SOURCE_ID } from "./vendor-gate";
import type { ApplyOutcome, WatchSource } from "./types";

/**
 * Applying one APPROVED vendor change to the live data (the other half of the gate: lib/watch/vendor-gate.ts holds the change back, an administrator's approval writes it).
 * Three kinds, and only columns the policy lists as waiting can be written, whatever a stored proposal says:
 *  - field_change: one column of one fighter, card, organisation, person or fight (`<kind>|<external id>|<column>`);
 *  - result_change: a fight's whole result with the judges' scores, and the fighters' career totals it explains, together;
 *  - list_change: one official-rankings list, replaced whole.
 * Each refuses a change that no longer fits what is held (`stale`: the live value is neither the old nor the new one) and is safe to run twice.
 */
export { VENDOR_SOURCE_ID };
type P = { kind: string; targetKey: string; old: unknown; new: unknown; evidence: unknown };
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const waits = (table: Table, column: string, group?: "result" | "totals") => POLICY.some((f) => f.table === table && f.column === column && f.rule === "wait" && f.group === group);
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

function applyField(db: DatabaseSync, p: P): ApplyOutcome {
  const [type, ext, column] = p.targetKey.split("|");
  const table = TABLE_OF[type];
  const o = obj(p.old), n = obj(p.new);
  if (!table || !ext || !column || !o || !n || !(column in o) || !(column in n)) return { ok: false, error: "bad_proposal" };
  // a waiting column that is not in a group (a result and the totals are applied with their result)
  if (!POLICY.some((f) => f.table === table && f.column === column && f.rule === "wait" && !f.group)) return { ok: false, error: "bad_proposal" };
  const row = db.prepare(`SELECT ${q(column)} v FROM ${table} WHERE external_id = ?`).get(ext) as { v: unknown } | undefined;
  if (!row) return { ok: false, error: "gone" };
  if (same(row.v, n[column])) return { ok: true, changed: false };
  if (!same(row.v, o[column])) return { ok: false, error: "stale" };
  db.prepare(`UPDATE ${table} SET ${q(column)} = ? WHERE external_id = ?`).run(n[column] as never, ext);
  return { ok: true, changed: true };
}

function applyResult(db: DatabaseSync, p: P): ApplyOutcome {
  const [type, ext, what] = p.targetKey.split("|");
  const o = obj(p.old), n = obj(p.new), ev = obj(p.evidence);
  if (type !== "bout" || what !== "result" || !ext || !o || !n) return { ok: false, error: "bad_proposal" };
  const cols = Object.keys(n);
  if (!cols.length || cols.some((c) => !(c in o) || !waits("bouts", c, "result"))) return { ok: false, error: "bad_proposal" };
  const totals = Array.isArray(ev?.totals) ? (ev!.totals as { boxerExt: string; old: Record<string, unknown>; new: Record<string, unknown> }[]) : [];
  for (const t of totals) if (!t.boxerExt || !obj(t.old) || !obj(t.new) || Object.keys(t.new).some((c) => !(c in t.old) || !waits("boxers", c, "totals"))) return { ok: false, error: "bad_proposal" };
  const live = db.prepare(`SELECT ${cols.map(q).join(", ")} FROM bouts WHERE external_id = ?`).get(ext) as Record<string, unknown> | undefined;
  if (!live) return { ok: false, error: "gone" };
  const isNew = cols.every((c) => same(live[c], n[c])), isOld = cols.every((c) => same(live[c], o[c]));
  if (!isNew && !isOld) return { ok: false, error: "stale" };
  const liveTotals = totals.map((t) => ({ t, row: db.prepare(`SELECT ${Object.keys(t.new).map(q).join(", ")} FROM boxers WHERE external_id = ?`).get(t.boxerExt) as Record<string, unknown> | undefined }));
  for (const { t, row } of liveTotals) {
    if (!row) return { ok: false, error: "gone" };
    const c = Object.keys(t.new);
    if (!c.every((k) => same(row[k], t.new[k])) && !c.every((k) => same(row[k], t.old[k]))) return { ok: false, error: "stale" };
  }
  let changed = false;
  if (isOld && !isNew) {
    db.prepare(`UPDATE bouts SET ${cols.map((c) => `${q(c)} = ?`).join(", ")} WHERE external_id = ?`).run(...(cols.map((c) => n[c]) as never[]), ext);
    changed = true;
  }
  for (const { t } of liveTotals) {
    const c = Object.keys(t.new);
    db.prepare(`UPDATE boxers SET ${c.map((k) => `${q(k)} = ?`).join(", ")} WHERE external_id = ?`).run(...(c.map((k) => t.new[k]) as never[]), t.boxerExt);
    changed = true;
  }
  const moved = ["winner_id", "method", "end_round"].some((c) => c in n && !same(o[c], n[c]));
  return { ok: true, changed, ratings: changed && moved };
}

type ListRow = { kind: string; rank: number | null; boxer_id: number | null; name: string | null; title_type: string | null; vacant: number; updated_at: string | null; position: number };
const sig = (rows: ListRow[]) => JSON.stringify(rows.map((r) => [r.kind, r.rank, r.boxer_id, r.name, r.title_type, r.vacant]));
function applyList(db: DatabaseSync, p: P): ApplyOutcome {
  const [type, body, division, sex] = p.targetKey.split("|");
  const o = obj(p.old), n = obj(p.new);
  if (type !== "list" || !body || !division || !sex || !Array.isArray(o?.rows) || !Array.isArray(n?.rows)) return { ok: false, error: "bad_proposal" };
  const live = db.prepare("SELECT kind, rank, boxer_id, name, title_type, vacant, updated_at, position FROM official_rankings WHERE body = ? AND division = ? AND sex = ? ORDER BY position, rank").all(body, division, sex) as unknown as ListRow[];
  if (sig(live) === sig(n!.rows as ListRow[])) return { ok: true, changed: false };
  if (sig(live) !== sig(o!.rows as ListRow[])) return { ok: false, error: "stale" };
  db.prepare("DELETE FROM official_rankings WHERE body = ? AND division = ? AND sex = ?").run(body, division, sex);
  const ins = db.prepare("INSERT INTO official_rankings (body, division, sex, kind, rank, boxer_id, name, title_type, vacant, updated_at, position) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const r of n!.rows as ListRow[]) ins.run(body, division, sex, r.kind, r.rank, r.boxer_id, r.name, r.title_type, r.vacant, r.updated_at, r.position);
  return { ok: true, changed: true };
}

export function applyVendorChange(main: DatabaseSync, p: P): ApplyOutcome {
  main.exec("BEGIN IMMEDIATE");
  try {
    const r = p.kind === "field_change" ? applyField(main, p) : p.kind === "result_change" ? applyResult(main, p) : p.kind === "list_change" ? applyList(main, p) : ({ ok: false, error: "bad_proposal" } as ApplyOutcome);
    if (r.ok) main.exec("COMMIT"); else main.exec("ROLLBACK");
    return r;
  } catch (e) { try { main.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}

/** The licensed vendor as a source of proposals. It is not watched (the daily update produces its proposals); it can only apply what an administrator approved. */
export const vendorSource: WatchSource = {
  id: VENDOR_SOURCE_ID,
  label: "The licensed vendor's daily update",
  kind: "details",
  terms: "Licensed feed (see the data page). Changes to rows we hold wait for an administrator; nothing here is applied without approval.",
  enabled: true,
  apply: applyVendorChange,
};
