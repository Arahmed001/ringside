import type { DatabaseSync } from "node:sqlite";
import { audit } from "../accounts/store";
import type { User } from "../accounts/users";
import { decide, type DecideError, type DecideReport } from "./decide";
import { groupOf } from "./group-key";
import { VENDOR_SOURCE_ID } from "./vendor-gate";

/**
 * The approval page's groups: the waiting proposals of one source and kind, by the field they are about ("boxers.height_cm: 412 changes, median change 2 cm, largest 15 cm", with
 * ten samples). An administrator can approve or reject a whole group at once, whatever its size: the server decides on exactly the proposals the page described (the count is
 * sent back and checked, so a proposal that arrived after the page loaded is never approved unseen).
 */
export interface GroupView {
  /** `source|kind|field`: the group's name for the page and the API */
  key: string; source: string; kind: string; field: string;
  count: number; fills: number; replaces: number; clears: number;
  numeric: boolean; medianDelta?: number; maxDelta?: number;
  samples: { id: number; label: string; old: unknown; new: unknown }[];
  oldestSeen: string;
}
const SAMPLES = 10;
const blank = (v: unknown) => v === null || v === undefined || v === "";
const median = (xs: number[]) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The one value a field_change is about (its old and new), for the statistics. */
function pair(kind: string, old: unknown, now: unknown): { old: unknown; new: unknown } {
  if (kind !== "field_change") return { old: undefined, new: undefined };
  const o = (old ?? {}) as Record<string, unknown>, n = (now ?? {}) as Record<string, unknown>, col = Object.keys(n)[0];
  return { old: o[col], new: n[col] };
}

export function proposalGroups(acc: DatabaseSync, status = "pending"): GroupView[] {
  const rows = acc.prepare("SELECT id, source, kind, target_key, label, old_json, new_json, first_seen FROM proposals WHERE status = ? ORDER BY source, kind, target_key").all(status) as { id: number; source: string; kind: string; target_key: string; label: string; old_json: string | null; new_json: string | null; first_seen: string }[];
  const groups = new Map<string, GroupView & { deltas: number[] }>();
  for (const r of rows) {
    const field = groupOf(r.kind, r.target_key), key = `${r.source}|${r.kind}|${field}`;
    const g = groups.get(key) ?? (() => { const x: GroupView & { deltas: number[] } = { key, source: r.source, kind: r.kind, field, count: 0, fills: 0, replaces: 0, clears: 0, numeric: false, samples: [], oldestSeen: r.first_seen, deltas: [] }; groups.set(key, x); return x; })();
    g.count++;
    if (r.first_seen < g.oldestSeen) g.oldestSeen = r.first_seen;
    const o = r.old_json ? JSON.parse(r.old_json) : null, n = r.new_json ? JSON.parse(r.new_json) : null;
    const { old, new: now } = pair(r.kind, o, n);
    if (r.kind === "field_change") {
      if (blank(old) && !blank(now)) g.fills++; else if (!blank(old) && blank(now)) g.clears++; else g.replaces++;
      if (typeof old === "number" && typeof now === "number") { g.numeric = true; g.deltas.push(Math.abs(now - old)); }
    }
    if (g.samples.length < SAMPLES) g.samples.push({ id: r.id, label: r.label, old: r.kind === "field_change" ? old : o, new: r.kind === "field_change" ? now : n });
  }
  return [...groups.values()].map(({ deltas, ...g }) => ({ ...g, ...(deltas.length ? { medianDelta: median(deltas), maxDelta: Math.max(...deltas) } : {}) })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export type GroupError = DecideError | "group_changed" | "group_empty";
export interface GroupResult { report: DecideReport; failed: Record<string, number> }
const BIG = 100000;

function idsOf(acc: DatabaseSync, source: string, kind: string | null, field: string | null): number[] {
  const rows = acc.prepare("SELECT id, kind, target_key FROM proposals WHERE status = 'pending' AND source = ? ORDER BY id").all(source) as { id: number; kind: string; target_key: string }[];
  return rows.filter((r) => (kind === null || r.kind === kind) && (field === null || groupOf(r.kind, r.target_key) === field)).map((r) => r.id);
}

/** Decides on every waiting proposal of one group. `expectCount` is how many the administrator was shown: any other number is refused (`group_changed`). */
export function decideGroup(admin: User | null, g: { source: string; kind: string; field: string; decision: "approved" | "rejected"; note: string; expectCount: number }, main: DatabaseSync, acc: DatabaseSync): GroupResult | { error: GroupError } {
  if (!admin || admin.role !== "admin") return { error: "forbidden" };
  const ids = idsOf(acc, g.source, g.kind, g.field);
  if (!ids.length) return { error: "group_empty" };
  if (ids.length !== g.expectCount) return { error: "group_changed" };
  const report = decide(admin, ids, g.decision, g.note, main, acc, BIG);
  if ("error" in report) return report;
  const failed: Record<string, number> = {};
  for (const r of report.results) if (!r.ok) failed[r.error ?? "failed"] = (failed[r.error ?? "failed"] ?? 0) + 1;
  audit(acc, admin.username, g.decision === "approved" ? "update.group_approve" : "update.group_reject", `group:${g.kind}|${g.field}`, JSON.stringify({ source: g.source, count: ids.length, done: report.approved + report.rejected, failed }));
  return { report, failed };
}

/**
 * The baseline action: accept the present state of the vendor's feed, in one logged step: every waiting vendor proposal. It is the answer to "the first night of holding left
 * a pile": after looking at the groups and their samples, an administrator accepts what is there so that what arrives afterwards is the real news. A note is required.
 */
export function acceptEverythingWaiting(admin: User | null, o: { note: string; expectCount: number }, main: DatabaseSync, acc: DatabaseSync): GroupResult | { error: GroupError } {
  if (!admin || admin.role !== "admin") return { error: "forbidden" };
  if (!o.note.trim()) return { error: "note_required" };
  const ids = idsOf(acc, VENDOR_SOURCE_ID, null, null);
  if (!ids.length) return { error: "group_empty" };
  if (ids.length !== o.expectCount) return { error: "group_changed" };
  const report = decide(admin, ids, "approved", o.note, main, acc, BIG);
  if ("error" in report) return report;
  const failed: Record<string, number> = {};
  for (const r of report.results) if (!r.ok) failed[r.error ?? "failed"] = (failed[r.error ?? "failed"] ?? 0) + 1;
  audit(acc, admin.username, "update.baseline", "vendor:boxing-data-api", JSON.stringify({ count: ids.length, done: report.approved, failed, note: o.note.slice(0, 300) }));
  return { report, failed };
}
