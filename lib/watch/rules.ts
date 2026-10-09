import type { DatabaseSync } from "node:sqlite";
import { audit, nowIso } from "../accounts/store";
import type { User } from "../accounts/users";
import { POLICY } from "./vendor-policy";
export { groupOf } from "./group-key";
import type { ChangeSet, FieldChange } from "./vendor-gate";

/**
 * An administrator's standing rules for the vendor's changes (docs/vendor-gate-plan.md, section 6). A rule says "a change in this group like this needs no approval":
 *   - any:       every change in the group (a field such as `boxers.nickname`, `result` for fights' results, `lists` for ranking lists);
 *   - fills:     only a blank being filled (a missing nickname gets one);
 *   - max_delta: only a number that moves by at most `amount` (height within 3 cm).
 * A rule is applied inside the update, before the old values are put back, so a change it accepts simply stays; the flood guard has already looked at the whole night, so a
 * rule cannot hide a changed format from it. Every night's use is written to the audit log. Only administrators make or remove rules; only the vendor's changes have them.
 */
export const RULE_SOURCE = "vendor:boxing-data-api";
export type Condition = "any" | "fills" | "max_delta";
export interface Rule { id: number; source: string; field: string; condition: Condition; amount: number | null; note: string | null; createdAt: string; lastUsed: string | null; usedCount: number; createdBy: string | null }

/** The fields a rule can name: a waiting column that stands alone, the result, the ranking lists. */
export function ruleFields(): string[] {
  return [...POLICY.filter((f) => f.rule === "wait" && !f.group).map((f) => `${f.table}.${f.column}`), ...POLICY.filter((f) => f.rule === "wait" && f.group === "totals").map((f) => `${f.table}.${f.column}`), "result", "lists"];
}
const numeric = (field: string) => { const [t, c] = field.split("."); return POLICY.some((f) => f.table === t && f.column === c && f.numeric); };

export type RuleError = "forbidden" | "field_unknown" | "condition_invalid" | "amount_invalid" | "duplicate" | "not_found";
const blank = (v: unknown) => v === null || v === undefined || v === "";

export function addRule(admin: User | null, r: { field: string; condition: string; amount?: number | null; note?: string }, acc: DatabaseSync, now = nowIso()): { ok: true; id: number } | { ok: false; error: RuleError } {
  if (!admin || admin.role !== "admin") return { ok: false, error: "forbidden" };
  if (!ruleFields().includes(r.field)) return { ok: false, error: "field_unknown" };
  if (!["any", "fills", "max_delta"].includes(r.condition)) return { ok: false, error: "condition_invalid" };
  const group = r.field === "result" || r.field === "lists";
  if (group && r.condition !== "any") return { ok: false, error: "condition_invalid" }; // a result or a list is accepted whole or not at all
  if (r.condition === "max_delta") {
    if (!numeric(r.field)) return { ok: false, error: "condition_invalid" };
    if (typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount < 0 || r.amount > 1e6) return { ok: false, error: "amount_invalid" };
  }
  const amount = r.condition === "max_delta" ? r.amount! : null;
  try {
    const id = Number(acc.prepare("INSERT INTO watch_rules (source, field, condition, amount, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)").run(RULE_SOURCE, r.field, r.condition, amount, (r.note ?? "").slice(0, 300) || null, admin.id, now).lastInsertRowid);
    audit(acc, admin.username, "update.rule_add", `rule:${id}`, JSON.stringify({ field: r.field, condition: r.condition, amount }));
    return { ok: true, id };
  } catch (e) { if (/UNIQUE/.test(String(e))) return { ok: false, error: "duplicate" }; throw e; }
}

export function removeRule(admin: User | null, id: number, acc: DatabaseSync): { ok: true } | { ok: false; error: RuleError } {
  if (!admin || admin.role !== "admin") return { ok: false, error: "forbidden" };
  const r = acc.prepare("DELETE FROM watch_rules WHERE id = ?").run(id);
  if (!Number(r.changes)) return { ok: false, error: "not_found" };
  audit(acc, admin.username, "update.rule_remove", `rule:${id}`);
  return { ok: true };
}

export function listRules(acc: DatabaseSync | null): Rule[] {
  if (!acc) return [];
  try {
    return (acc.prepare("SELECT r.*, u.username by_name FROM watch_rules r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.id").all() as Record<string, unknown>[]).map((x) => ({
      id: x.id as number, source: x.source as string, field: x.field as string, condition: x.condition as Condition, amount: (x.amount as number | null) ?? null, note: (x.note as string | null) ?? null,
      createdAt: x.created_at as string, lastUsed: (x.last_used as string | null) ?? null, usedCount: x.used_count as number, createdBy: (x.by_name as string | null) ?? null,
    }));
  } catch { return []; }
}

export const accepts = (rule: Pick<Rule, "condition" | "amount">, change: { old: unknown; new: unknown }): boolean =>
  rule.condition === "any" ? true
    : rule.condition === "fills" ? blank(change.old) && !blank(change.new)
    : typeof change.old === "number" && typeof change.new === "number" && Math.abs(change.new - change.old) <= (rule.amount ?? -1);

export interface RuleUse { rule: Rule; count: number }
/**
 * Takes out of a change set the changes that a standing rule accepts (they stay in the database as the update wrote them), and says how many each rule took. A result that is
 * accepted takes the fighters' totals that ride with it; a list is accepted whole.
 */
export function applyRules(cs: ChangeSet, rules: Rule[]): { held: ChangeSet; uses: RuleUse[] } {
  const uses = new Map<number, RuleUse>();
  const tally = (rule: Rule) => { const u = uses.get(rule.id) ?? { rule, count: 0 }; u.count++; uses.set(rule.id, u); };
  const byField = new Map<string, Rule[]>();
  for (const r of rules) (byField.get(r.field) ?? byField.set(r.field, []).get(r.field)!).push(r);
  const first = (field: string, ch: { old: unknown; new: unknown }) => (byField.get(field) ?? []).find((r) => accepts(r, ch));

  const fields: FieldChange[] = [];
  for (const c of cs.fields) { const r = first(`${c.table}.${c.column}`, c); if (r) tally(r); else fields.push(c); }
  const dropTotals = new Set<string>(); // `<boxer external id>|<column>` of totals that ride with an accepted result
  const results = cs.results.filter((x) => { const r = first("result", { old: 1, new: 2 }); if (!r) return true; tally(r); for (const t of x.totals) for (const col of Object.keys(t.new)) dropTotals.add(`${t.boxerExt}|${col}`); return false; });
  const lists = cs.lists.filter(() => { const r = first("lists", { old: 1, new: 2 }); if (r) { tally(r); return false; } return true; });
  return { held: { ...cs, fields, results, lists, folded: cs.folded.filter((f) => !dropTotals.has(`${f.ext}|${f.column}`)) }, uses: [...uses.values()] };
}

/** Writes the night's use of each rule to the audit log and the rule's own counters. Call after the update has committed. */
export function recordRuleUse(acc: DatabaseSync, uses: RuleUse[], now = nowIso()): void {
  const bump = acc.prepare("UPDATE watch_rules SET used_count = used_count + ?, last_used = ? WHERE id = ?");
  for (const u of uses) {
    bump.run(u.count, now, u.rule.id);
    audit(acc, "rule", "update.rule_applied", `rule:${u.rule.id}`, JSON.stringify({ field: u.rule.field, condition: u.rule.condition, amount: u.rule.amount, accepted: u.count }));
  }
}
