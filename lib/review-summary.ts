import type { DatabaseSync } from "node:sqlite";
import { pendingCount } from "./watch/decide";

/** What waits for an editor, one number for each of the editors' pages, so /review can show where something needs doing. Counts only. */
export interface ReviewSummary { teamEdits: number; reports: number; forum: number; updates: number; posts: number; pictures: number }

const n = (db: DatabaseSync, sql: string): number => { try { return (db.prepare(sql).get() as { c: number }).c; } catch { return 0; } };

export function reviewSummary(acc: DatabaseSync): ReviewSummary {
  return {
    teamEdits: n(acc, "SELECT COUNT(*) c FROM contributions WHERE status = 'pending'"),
    reports: n(acc, "SELECT COUNT(*) c FROM reports WHERE status = 'open'"),
    forum: n(acc, "SELECT COUNT(DISTINCT post_id) c FROM forum_reports WHERE status = 'open'"),
    updates: pendingCount(acc),
    posts: n(acc, "SELECT COUNT(*) c FROM social_posts"),
    pictures: n(acc, "SELECT COUNT(*) c FROM licensed_images"),
  };
}
