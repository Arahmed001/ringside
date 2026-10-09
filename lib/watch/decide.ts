import type { DatabaseSync } from "node:sqlite";
import { audit, nowIso } from "../accounts/store";
import type { User } from "../accounts/users";
import { SOURCES } from "./run";
import { applyCorrections } from "../accounts/corrections";
import { recomputeRatings } from "../ingest";

export const MAX_BATCH = 50;
export type DecideError = "forbidden" | "not_found" | "not_pending" | "unknown_source" | "stale" | "gone" | "bad_proposal" | "note_required" | "too_many" | "failed";
export interface Decided { id: number; ok: boolean; error?: DecideError }
export interface DecideReport { results: Decided[]; approved: number; rejected: number; changedData: boolean; ratingsRecomputed: boolean }

/**
 * An admin's decision on proposed changes. This is the only place a proposal changes the live data, and only an admin may call it (editors keep the report queues).
 *  - approve: the source's `apply` writes the change to the live data, then the proposal is marked approved with who and when, and an audit row names it. A change that no
 *    longer fits what is held (`stale`, `gone`) is refused and stays pending: the next watch run will replace or retire it.
 *  - reject: needs a note (why), and is remembered, so the same change is not raised again while the source says the same.
 * Each id is decided on its own: one that cannot be applied does not stop the others, and the report says which. At most MAX_BATCH ids in a call (a group decision, lib/watch/groups.ts, raises the limit: it decides on exactly the proposals it was shown).
 */
export function decide(admin: User | null, ids: number[], decision: "approved" | "rejected", note: string, main: DatabaseSync, acc: DatabaseSync, limit = MAX_BATCH): DecideReport | { error: DecideError } {
  if (!admin || admin.role !== "admin") return { error: "forbidden" };
  if (!ids.length || ids.length > limit) return { error: "too_many" };
  note = note.trim();
  if (decision === "rejected" && !note) return { error: "note_required" };
  const report: DecideReport = { results: [], approved: 0, rejected: 0, changedData: false, ratingsRecomputed: false };
  let ratings = false;
  const get = acc.prepare("SELECT * FROM proposals WHERE id = ?");
  const mark = acc.prepare("UPDATE proposals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND status = 'pending'");
  for (const id of [...new Set(ids)]) {
    const p = get.get(id) as Record<string, string | number | null> | undefined;
    if (!p) { report.results.push({ id, ok: false, error: "not_found" }); continue; }
    if (p.status !== "pending") { report.results.push({ id, ok: false, error: "not_pending" }); continue; }
    if (decision === "approved") {
      const src = SOURCES.find((s) => s.id === p.source);
      if (!src) { report.results.push({ id, ok: false, error: "unknown_source" }); continue; }
      let r;
      try {
        r = src.apply(main, { kind: p.kind as string, targetKey: p.target_key as string, old: json(p.old_json), new: json(p.new_json), evidence: json(p.evidence_json) });
      } catch { report.results.push({ id, ok: false, error: "failed" }); continue; }
      if (!r.ok) { report.results.push({ id, ok: false, error: r.error }); continue; }
      if (r.changed) report.changedData = true;
      if (r.ok && r.ratings) ratings = true;
    }
    mark.run(decision, admin.id, nowIso(), note || null, id);
    audit(acc, admin.username, decision === "approved" ? "update.approve" : "update.reject", `proposal:${id}`, JSON.stringify({ source: p.source, kind: p.kind, key: p.target_key, note: note || undefined }));
    report.results.push({ id, ok: true });
    if (decision === "approved") report.approved++; else report.rejected++;
  }
  // what the daily update does after it writes, done once for the whole batch: accepted corrections are put back over what was approved, and a moved result moves the ratings
  if (report.changedData) {
    try { applyCorrections(main, acc); } catch (e) { console.error("corrections not applied:", (e as Error).message); }
    if (ratings) { recomputeRatings(main); report.ratingsRecomputed = true; }
  }
  return report;
}

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : null);

/** How many proposals wait, for /review and /api/health. */
export function pendingCount(acc: DatabaseSync | null): number {
  if (!acc) return 0;
  try { return (acc.prepare("SELECT COUNT(*) c FROM proposals WHERE status = 'pending'").get() as { c: number }).c; } catch { return 0; }
}
