import type { DatabaseSync } from "node:sqlite";
import { auditMentioning } from "./store";
import type { User } from "./users";

/**
 * Everything the accounts database holds about one person, as a plain object: what /api/account/export downloads and what the privacy page promises.
 * Each table that has a `user_id` is either exported here or named in NOT_EXPORTED with the reason, and a test fails when a table is in neither:
 * adding somewhere to keep personal data has to be a decision about the export (and so about the privacy page), not an accident.
 */
export const EXPORTED_TABLES: Record<string, string> = { picks: "picks", watchlist: "watchlist", contributions: "contributions", reports: "reports", boxer_owners: "linkedFighters", forum_threads: "forumThreads", forum_posts: "forumPosts", forum_reports: "forumReports", sessions: "sessions" };
export const NOT_EXPORTED: Record<string, string> = {
  resets: "a one-time sign-in code, stored only as a hash, valid for an hour: it identifies no one and reveals nothing",
};

export function exportFor(user: User, db: DatabaseSync, now = new Date()) {
  const one = db.prepare("SELECT last_login, picks_seen_through FROM users WHERE id = ?").get(user.id) as { last_login: string | null; picks_seen_through: string | null } | undefined;
  return {
    exportedAt: now.toISOString(),
    user: { username: user.username, role: user.role, createdAt: user.createdAt, lastSignIn: one?.last_login ?? null, picksPublic: user.picksPublic, picksSeenThrough: one?.picks_seen_through ?? null },
    // where you are signed in: a coarse device label and dates (never the token, or what the browser sent beyond the label)
    sessions: db.prepare("SELECT label AS device, created_at AS signedInAt, last_seen AS lastUsedAt, expires_at AS expiresAt FROM sessions WHERE user_id = ? ORDER BY created_at").all(user.id),
    picks: db.prepare("SELECT bout_ext AS bout, boxer_ext AS pickedBoxer, picked_at AS pickedAt FROM picks WHERE user_id = ? ORDER BY picked_at").all(user.id),
    watchlist: db.prepare("SELECT boxer_ext AS fighter, added_at AS addedAt FROM watchlist WHERE user_id = ? ORDER BY added_at, boxer_ext").all(user.id),
    contributions: db.prepare("SELECT id, status, boxer_ext AS boxer, role, person_name AS person, start_date AS start, end_date AS end, source_url AS sourceUrl, quote, note, created_at AS createdAt, reviewed_at AS reviewedAt, review_note AS reviewNote FROM contributions WHERE user_id = ? ORDER BY id").all(user.id),
    // reports of a wrong fact, including the contact you gave with them
    reports: db.prepare("SELECT id, kind, target_type AS targetType, target_ext AS target, field, shown_value AS shownValue, proposed_value AS proposedValue, source_url AS sourceUrl, quote, note, contact, status, created_at AS createdAt, reviewed_at AS reviewedAt, review_note AS reviewNote FROM reports WHERE user_id = ? ORDER BY id").all(user.id),
    // fighters an administrator has linked to your account as their own
    linkedFighters: db.prepare("SELECT boxer_ext AS fighter, verified_by AS verifiedBy, verified_at AS verifiedAt, note, official_urls AS officialUrls FROM boxer_owners WHERE user_id = ? ORDER BY boxer_ext").all(user.id),
    // what you wrote in the forum (a fighter's or a fight's thread is named by the fighter's or fight's id), the threads you started, and the posts you reported
    forumThreads: db.prepare("SELECT id, kind, subject_ext AS subject, title, created_at AS createdAt, locked FROM forum_threads WHERE user_id = ? ORDER BY id").all(user.id),
    forumPosts: db.prepare("SELECT id, thread_id AS thread, body, created_at AS createdAt, edited_at AS editedAt, status, hidden_reason AS hiddenReason FROM forum_posts WHERE user_id = ? ORDER BY id").all(user.id),
    forumReports: db.prepare("SELECT id, post_id AS post, reason, note, status, created_at AS createdAt FROM forum_reports WHERE user_id = ? ORDER BY id").all(user.id),
    // the activity log, for the entries that name you: things you did, and things done about you
    activity: auditMentioning(db, user.username).map((r) => ({ at: r.at, by: r.actor, action: r.action, about: r.target, detail: r.detail })),
  };
}
