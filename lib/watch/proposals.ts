import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Change } from "./types";

/** A rejected change is remembered, so it is not raised again while the source says the same, for this many days; then it is raised once more for a fresh decision (owner's decision, 2026-10-09). */
export const REJECT_MEMORY_DAYS = 30;
export const rejectMemoryDays = (raw: string | undefined = process.env.PROPOSAL_REJECT_MEMORY_DAYS) => { const n = Number(raw); return Number.isFinite(n) && n >= 0 && raw?.trim() ? n : REJECT_MEMORY_DAYS; };

export const fingerprint = (c: Pick<Change, "kind" | "new">) => createHash("sha256").update(JSON.stringify([c.kind, c.new])).digest("hex").slice(0, 32);

export interface ReconcileReport { added: number; updated: number; unchanged: number; remembered: number; superseded: number }

/**
 * Turns a run's differences into pending proposals, and nothing else.
 *  - a change already pending for the same thing is updated (its newer reading, `last_seen`), not duplicated;
 *  - a change an admin rejected is not raised again while the source still says the same (same fingerprint), for 30 days after the rejection; then it is raised once more;
 *  - a pending proposal inside `scope` that the run no longer finds (the source went back, or the live data caught up) is marked superseded, so the queue holds only what is still true.
 */
export function reconcile(acc: DatabaseSync, source: string, changes: Change[], scope: string[] | ((key: string) => boolean), now = new Date().toISOString()): ReconcileReport {
  const r: ReconcileReport = { added: 0, updated: 0, unchanged: 0, remembered: 0, superseded: 0 };
  const pending = new Map((acc.prepare("SELECT id, target_key, fingerprint, new_json, label FROM proposals WHERE source = ? AND status = 'pending'").all(source) as { id: number; target_key: string; fingerprint: string; new_json: string | null; label: string }[]).map((p) => [p.target_key, p]));
  const seen = new Set<string>();
  const rejected = acc.prepare("SELECT 1 x FROM proposals WHERE source = ? AND target_key = ? AND fingerprint = ? AND status = 'rejected' AND COALESCE(decided_at, '') > ? LIMIT 1");
  const memoryFrom = new Date(Date.parse(now) - rejectMemoryDays() * 86400000).toISOString();
  const insert = acc.prepare("INSERT INTO proposals (source, kind, target_key, label, old_json, new_json, evidence_json, fingerprint, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const refresh = acc.prepare("UPDATE proposals SET kind = ?, label = ?, old_json = ?, new_json = ?, evidence_json = ?, fingerprint = ?, last_seen = ? WHERE id = ?");
  const touch = acc.prepare("UPDATE proposals SET last_seen = ? WHERE id = ?");
  acc.exec("BEGIN");
  try {
    for (const c of changes) {
      if (seen.has(c.targetKey)) continue; // one proposal per thing per run
      seen.add(c.targetKey);
      const fp = fingerprint(c);
      const have = pending.get(c.targetKey);
      if (have) {
        if (have.fingerprint === fp) { touch.run(now, have.id); r.unchanged++; }
        else { refresh.run(c.kind, c.label, JSON.stringify(c.old), JSON.stringify(c.new), JSON.stringify(c.evidence), fp, now, have.id); r.updated++; }
        continue;
      }
      if (rejected.get(source, c.targetKey, fp, memoryFrom)) { r.remembered++; continue; }
      insert.run(source, c.kind, c.targetKey, c.label, JSON.stringify(c.old), JSON.stringify(c.new), JSON.stringify(c.evidence), fp, now, now);
      r.added++;
    }
    const gone = acc.prepare("UPDATE proposals SET status = 'superseded', last_seen = ? WHERE id = ?");
    for (const [key, p] of pending) {
      if (seen.has(key) || !(typeof scope === "function" ? scope(key) : scope.some((x) => key.startsWith(x)))) continue;
      gone.run(now, p.id); r.superseded++;
    }
    acc.exec("COMMIT");
  } catch (e) { acc.exec("ROLLBACK"); throw e; }
  return r;
}

export interface ProposalRow { id: number; source: string; kind: string; targetKey: string; label: string; old: unknown; new: unknown; evidence: unknown; status: string; firstSeen: string; lastSeen: string; decidedBy: string | null; decidedAt: string | null; note: string | null }
export function listProposals(acc: DatabaseSync, o: { status?: string; source?: string; limit?: number } = {}): ProposalRow[] {
  const rows = acc.prepare(`SELECT p.*, u.username decided_name FROM proposals p LEFT JOIN users u ON u.id = p.decided_by WHERE p.status = ? ${o.source ? "AND p.source = ?" : ""} ORDER BY p.source, p.kind, p.target_key LIMIT ?`)
    .all(...(o.source ? [o.status ?? "pending", o.source, o.limit ?? 500] : [o.status ?? "pending", o.limit ?? 500])) as Record<string, string | number | null>[];
  const j = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : null);
  return rows.map((r) => ({ id: r.id as number, source: r.source as string, kind: r.kind as string, targetKey: r.target_key as string, label: r.label as string, old: j(r.old_json), new: j(r.new_json), evidence: j(r.evidence_json), status: r.status as string, firstSeen: r.first_seen as string, lastSeen: r.last_seen as string, decidedBy: (r.decided_name as string | null) ?? null, decidedAt: (r.decided_at as string | null) ?? null, note: (r.note as string | null) ?? null }));
}

/** Counts per status, for the tabs. */
export function proposalCounts(acc: DatabaseSync): Record<string, number> {
  const out: Record<string, number> = { pending: 0, approved: 0, rejected: 0, superseded: 0 };
  for (const r of acc.prepare("SELECT status, COUNT(*) c FROM proposals GROUP BY status").all() as { status: string; c: number }[]) out[r.status] = r.c;
  return out;
}
