import type { DatabaseSync } from "node:sqlite";

/**
 * How long changes have been waiting for an administrator, for /api/health and the doctor. A site that holds the vendor's changes for approval shows the last APPROVED data, so a
 * queue nobody reads is a site that quietly falls behind: the stale-data warning follows whether the update ran, not whether its result was accepted, so this is the other half.
 */
export const DEFAULT_OVERDUE_DAYS = 7;
/** UPDATES_OVERDUE_DAYS: how many days the oldest waiting change may wait before it is called overdue (default 7). */
export const overdueDays = (raw: string | undefined = process.env.UPDATES_OVERDUE_DAYS): number => { const n = Number(raw); return raw?.trim() && Number.isFinite(n) && n >= 1 ? n : DEFAULT_OVERDUE_DAYS; };

export interface Waiting { waiting: number; oldestSeen: string | null; ageDays: number | null; overdue: boolean }

export function waitingSummary(acc: DatabaseSync | null, nowMs: number, threshold = overdueDays()): Waiting {
  const none: Waiting = { waiting: 0, oldestSeen: null, ageDays: null, overdue: false };
  if (!acc) return none;
  try {
    const r = acc.prepare("SELECT COUNT(*) c, MIN(first_seen) oldest FROM proposals WHERE status = 'pending'").get() as { c: number; oldest: string | null };
    if (!r.c) return none;
    const t = r.oldest ? Date.parse(r.oldest) : NaN;
    const ageDays = Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86_400_000)) : null;
    return { waiting: r.c, oldestSeen: r.oldest, ageDays, overdue: ageDays !== null && ageDays >= threshold };
  } catch { return none; }
}
