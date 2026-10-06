import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { accountsDb, audit } from "../accounts/store";
import { limits } from "../accounts/guard";
import type { User } from "../accounts/users";
import { AUTO_HIDE_REPORTS, EDIT_WINDOW_MS, NEW_ACCOUNT_AGE_MS, NEW_ACCOUNT_DAILY, NEW_ACCOUNT_WAIT_MS, PAGE_SIZE, THREADS_PAGE, TITLE_MAX, TITLE_MIN, checkText, normalizedWords, type PostProblem, REPORT_REASONS } from "./rules";

/**
 * The forum (round 125): discussion under each fighter and each fight (one thread per subject, made when the first post is written) and a general board where
 * people start threads. It lives in the accounts database, next to the people who write in it, and refers to fighters and fights by their external ids (as picks do),
 * so a rebuilt sports database leaves it intact. Plain text only; see rules.ts for what is refused. A post is `visible`, `hidden` (by a moderator or by enough reports;
 * the place stays, the words do not) or `deleted` (by its author; the words are wiped).
 */
export type Kind = "boxer" | "bout" | "general";
export type ForumError = PostProblem | "unauthorized" | "forbidden" | "not_found" | "locked" | "too_new" | "rate_limited" | "duplicate" | "title_invalid" | "no_such_subject" | "edit_window_over" | "own_post" | "bad_reason" | "already_reported";

export interface ThreadRow { id: number; kind: Kind; subject: string | null; title: string | null; author: string | null; createdAt: string; lastPostAt: string; postCount: number; locked: boolean }
export interface PostView { id: number; author: string | null; body: string | null; status: "visible" | "hidden" | "deleted"; createdAt: string; editedAt: string | null; mine: boolean; reports?: number }

/** A hash of the words (see normalizedWords): enough to notice the same post twice, not enough to read it back. */
export const fingerprint = (text: string): string => crypto.createHash("sha256").update(normalizedWords(text)).digest("hex").slice(0, 32);

type Fail = { ok: false; error: ForumError };
const no = (error: ForumError): Fail => ({ ok: false, error });

/** The external id of a fighter (by slug) or a fight (by its address number) in the sports database, or null. */
export function subjectExt(main: DatabaseSync, kind: "boxer" | "bout", subject: string): string | null {
  if (typeof subject !== "string" || !subject) return null;
  const row = kind === "boxer"
    ? main.prepare("SELECT external_id e FROM boxers WHERE slug = ?").get(subject)
    : /^\d{1,9}$/.test(subject) ? main.prepare("SELECT external_id e FROM bouts WHERE id = ?").get(Number(subject)) : undefined;
  return ((row as { e: string } | undefined)?.e) ?? null;
}

const threadOf = (r: Record<string, unknown>): ThreadRow => ({
  id: r.id as number, kind: r.kind as Kind, subject: (r.subject_ext as string | null) ?? null, title: (r.title as string | null) ?? null, author: (r.author as string | null) ?? null,
  createdAt: r.created_at as string, lastPostAt: r.last_post_at as string, postCount: r.post_count as number, locked: !!r.locked,
});
const THREAD_SQL = "SELECT t.*, u.username AS author FROM forum_threads t LEFT JOIN users u ON u.id = t.user_id";

/** The thread under a fighter or a fight, if anyone has written there yet (nothing is created by looking). */
export function findSubjectThread(main: DatabaseSync, kind: "boxer" | "bout", subject: string, acc: DatabaseSync = accountsDb()): ThreadRow | null {
  const ext = subjectExt(main, kind, subject);
  if (!ext) return null;
  const r = acc.prepare(`${THREAD_SQL} WHERE t.kind = ? AND t.subject_ext = ? AND t.hidden = 0`).get(kind, ext) as Record<string, unknown> | undefined;
  return r ? threadOf(r) : null;
}
export const getThread = (id: number, acc: DatabaseSync = accountsDb()): ThreadRow | null => {
  const r = acc.prepare(`${THREAD_SQL} WHERE t.id = ? AND t.hidden = 0`).get(id) as Record<string, unknown> | undefined;
  return r ? threadOf(r) : null;
};

/** The general board, newest activity first, a page at a time. */
export function listThreads(page: number, acc: DatabaseSync = accountsDb()): { threads: ThreadRow[]; total: number; pages: number; page: number } {
  const total = (acc.prepare("SELECT COUNT(*) c FROM forum_threads WHERE kind = 'general' AND hidden = 0").get() as { c: number }).c;
  const pages = Math.max(1, Math.ceil(total / THREADS_PAGE)), p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = acc.prepare(`${THREAD_SQL} WHERE t.kind = 'general' AND t.hidden = 0 ORDER BY t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`).all(THREADS_PAGE, (p - 1) * THREADS_PAGE) as Record<string, unknown>[];
  return { threads: rows.map(threadOf), total, pages, page: p };
}

/** Posts of a thread, oldest first, `PAGE_SIZE` after the post id `after`. A hidden or deleted post is a place with no words and no author. */
export function listPosts(threadId: number, viewer: User | null, after = 0, acc: DatabaseSync = accountsDb()): { posts: PostView[]; more: boolean } {
  const canSee = viewer?.role === "editor" || viewer?.role === "admin";
  const rows = acc.prepare(
    `SELECT p.*, u.username AS author, (SELECT COUNT(*) FROM forum_reports r WHERE r.post_id = p.id AND r.status = 'open') AS open_reports
     FROM forum_posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.thread_id = ? AND p.id > ? ORDER BY p.id LIMIT ?`).all(threadId, Math.max(0, after | 0), PAGE_SIZE + 1) as Record<string, unknown>[];
  const posts = rows.slice(0, PAGE_SIZE).map((r): PostView => {
    const status = r.status as PostView["status"], shown = status === "visible";
    return {
      id: r.id as number, author: shown ? ((r.author as string | null) ?? null) : null, body: shown ? (r.body as string) : null, status, createdAt: r.created_at as string,
      editedAt: (r.edited_at as string | null) ?? null, mine: !!viewer && r.user_id === viewer.id, ...(canSee ? { reports: r.open_reports as number } : {}),
    };
  });
  return { posts, more: rows.length > PAGE_SIZE };
}

/** Why this person cannot write now, or null: a disabled account, an account too new, a day's allowance for a young account. */
function mayPost(user: User, acc: DatabaseSync, now: number): ForumError | null {
  const row = acc.prepare("SELECT disabled, created_at FROM users WHERE id = ?").get(user.id) as { disabled: number; created_at: string } | undefined;
  if (!row || row.disabled) return "forbidden";
  const age = now - Date.parse(row.created_at);
  if (age < NEW_ACCOUNT_WAIT_MS) return "too_new";
  if (age < NEW_ACCOUNT_AGE_MS) {
    const since = new Date(now - 24 * 60 * 60_000).toISOString();
    if ((acc.prepare("SELECT COUNT(*) c FROM forum_posts WHERE user_id = ? AND created_at > ?").get(user.id, since) as { c: number }).c >= NEW_ACCOUNT_DAILY) return "rate_limited";
  }
  return null;
}

/** The limits are spent only by a post that is otherwise acceptable, so a refused post costs nothing. */
function allowance(user: User, ip: string): boolean {
  const l = limits();
  if (l.forumPost.left(`u${user.id}`) < 1 || l.forumPostIp.left(ip) < 1) return false;
  l.forumPost.take(`u${user.id}`); l.forumPostIp.take(ip);
  return true;
}

function insertPost(acc: DatabaseSync, threadId: number, user: User, text: string, at: string): number {
  const id = (acc.prepare("INSERT INTO forum_posts (thread_id, user_id, body, fingerprint, created_at) VALUES (?,?,?,?,?) RETURNING id").get(threadId, user.id, text, fingerprint(text), at) as { id: number }).id;
  acc.prepare("UPDATE forum_threads SET post_count = post_count + 1, last_post_at = ? WHERE id = ?").run(at, threadId);
  return id;
}
const isDuplicate = (acc: DatabaseSync, user: User, text: string, now: number) =>
  !!acc.prepare("SELECT 1 x FROM forum_posts WHERE user_id = ? AND fingerprint = ? AND created_at > ? AND status <> 'deleted'").get(user.id, fingerprint(text), new Date(now - 24 * 60 * 60_000).toISOString());

/** Writes under a fighter or a fight (made on the first post), or into an existing thread by id. */
export function addPost(user: User, target: { kind: "boxer" | "bout"; subject: string } | { threadId: number }, body: unknown, ip: string, main: DatabaseSync, acc: DatabaseSync = accountsDb(), now = Date.now()): { ok: true; id: number; threadId: number } | Fail {
  const c = checkText(body); if (c.problem) return no(c.problem);
  const bar = mayPost(user, acc, now); if (bar) return no(bar);
  let threadId: number | null = null, ext: string | null = null;
  if ("threadId" in target) {
    const t = getThread(target.threadId, acc);
    if (!t) return no("not_found");
    if (t.locked) return no("locked");
    threadId = t.id;
  } else {
    ext = subjectExt(main, target.kind, target.subject);
    if (!ext) return no("no_such_subject");
    const existing = acc.prepare("SELECT id, locked, hidden FROM forum_threads WHERE kind = ? AND subject_ext = ?").get(target.kind, ext) as { id: number; locked: number; hidden: number } | undefined;
    if (existing?.hidden) return no("not_found");
    if (existing?.locked) return no("locked");
    threadId = existing?.id ?? null;
  }
  if (isDuplicate(acc, user, c.text, now)) return no("duplicate");
  if (!allowance(user, ip)) return no("rate_limited");
  const at = new Date(now).toISOString();
  // the thread under a subject is made only now, by a post that is going to be kept: a refused post leaves nothing behind
  if (threadId === null) threadId = (acc.prepare("INSERT INTO forum_threads (kind, subject_ext, user_id, created_at, last_post_at) VALUES (?,?,?,?,?) RETURNING id").get((target as { kind: string }).kind, ext, user.id, at, at) as { id: number }).id;
  const id = insertPost(acc, threadId, user, c.text, at);
  return { ok: true, id, threadId };
}

/** A new thread on the general board: a title and a first post. */
export function startThread(user: User, title: unknown, body: unknown, ip: string, acc: DatabaseSync = accountsDb(), now = Date.now()): { ok: true; threadId: number; postId: number } | Fail {
  const t = checkText(title, { min: TITLE_MIN, max: TITLE_MAX });
  if (t.problem || t.text.includes("\n")) return no("title_invalid");
  const c = checkText(body); if (c.problem) return no(c.problem);
  const bar = mayPost(user, acc, now); if (bar) return no(bar);
  if (isDuplicate(acc, user, c.text, now)) return no("duplicate");
  const l = limits();
  if (l.forumThread.left(`u${user.id}`) < 1 || l.forumPost.left(`u${user.id}`) < 1 || l.forumPostIp.left(ip) < 1) return no("rate_limited");
  l.forumThread.take(`u${user.id}`); l.forumPost.take(`u${user.id}`); l.forumPostIp.take(ip);
  const at = new Date(now).toISOString();
  const threadId = (acc.prepare("INSERT INTO forum_threads (kind, title, user_id, created_at, last_post_at) VALUES ('general',?,?,?,?) RETURNING id").get(t.text, user.id, at, at) as { id: number }).id;
  return { ok: true, threadId, postId: insertPost(acc, threadId, user, c.text, at) };
}

const postRow = (acc: DatabaseSync, id: number) => acc.prepare("SELECT * FROM forum_posts WHERE id = ?").get(id) as Record<string, unknown> | undefined;

/** The author changes their own post, for a quarter of an hour after writing it. */
export function editPost(user: User, id: number, body: unknown, acc: DatabaseSync = accountsDb(), now = Date.now()): { ok: true } | Fail {
  const p = postRow(acc, id);
  if (!p) return no("not_found");
  if (p.user_id !== user.id || p.status !== "visible") return no("forbidden");
  if (now - Date.parse(p.created_at as string) > EDIT_WINDOW_MS) return no("edit_window_over");
  const c = checkText(body); if (c.problem) return no(c.problem);
  acc.prepare("UPDATE forum_posts SET body = ?, fingerprint = ?, edited_at = ? WHERE id = ?").run(c.text, fingerprint(c.text), new Date(now).toISOString(), id);
  return { ok: true };
}

/** The author withdraws their own post: the words are wiped and the place stays, so replies still make sense. */
export function deleteOwnPost(user: User, id: number, acc: DatabaseSync = accountsDb()): { ok: true } | Fail {
  const p = postRow(acc, id);
  if (!p || p.user_id !== user.id) return no("not_found");
  acc.prepare("UPDATE forum_posts SET body = '', fingerprint = '', status = 'deleted' WHERE id = ?").run(id);
  return { ok: true };
}

/** Reporting a post (not your own; once per post per person). Enough different people hide it until an editor looks. */
export function reportPost(user: User, id: number, reason: unknown, note: unknown, acc: DatabaseSync = accountsDb(), now = Date.now()): { ok: true; hidden: boolean } | Fail {
  if (typeof reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(reason)) return no("bad_reason");
  const p = postRow(acc, id);
  if (!p || p.status === "deleted") return no("not_found");
  if (p.user_id === user.id) return no("own_post");
  if (acc.prepare("SELECT 1 x FROM forum_reports WHERE post_id = ? AND user_id = ?").get(id, user.id)) return no("already_reported");
  if (!limits().forumReport.take(`u${user.id}`)) return no("rate_limited");
  const n = typeof note === "string" ? checkText(note, { min: 0, max: 300 }).text : "";
  acc.prepare("INSERT INTO forum_reports (post_id, user_id, reason, note, created_at) VALUES (?,?,?,?,?)").run(id, user.id, reason, n || null, new Date(now).toISOString());
  const open = (acc.prepare("SELECT COUNT(DISTINCT user_id) c FROM forum_reports WHERE post_id = ? AND status = 'open'").get(id) as { c: number }).c;
  let hidden = false;
  if (open >= AUTO_HIDE_REPORTS && p.status === "visible") {
    acc.prepare("UPDATE forum_posts SET status = 'hidden', hidden_by = NULL, hidden_at = ?, hidden_reason = ? WHERE id = ?").run(new Date(now).toISOString(), `auto: ${open} reports`, id);
    audit(acc, null, "forum_auto_hide", `post#${id}`, `${open} reports`);
    hidden = true;
  }
  return { ok: true, hidden };
}

const isEditor = (u: User) => u.role === "editor" || u.role === "admin";

/** An editor hides a post or puts it back, with a reason that is kept in the activity log. Open reports on it are settled the same way (upheld by hiding, dismissed by restoring). */
export function moderatePost(editor: User, id: number, action: "hide" | "restore", reason: unknown, acc: DatabaseSync = accountsDb(), now = Date.now()): { ok: true } | Fail {
  if (!isEditor(editor)) return no("forbidden");
  const p = postRow(acc, id);
  if (!p || p.status === "deleted") return no("not_found");
  const why = typeof reason === "string" ? checkText(reason, { min: 0, max: 200 }).text : "";
  const at = new Date(now).toISOString();
  if (action === "hide") acc.prepare("UPDATE forum_posts SET status = 'hidden', hidden_by = ?, hidden_at = ?, hidden_reason = ? WHERE id = ?").run(editor.id, at, why || "hidden by a moderator", id);
  else acc.prepare("UPDATE forum_posts SET status = 'visible', hidden_by = NULL, hidden_at = NULL, hidden_reason = NULL WHERE id = ?").run(id);
  acc.prepare("UPDATE forum_reports SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE post_id = ? AND status = 'open'").run(action === "hide" ? "upheld" : "dismissed", editor.id, at, id);
  audit(acc, editor.username, action === "hide" ? "forum_hide" : "forum_restore", `post#${id}`, why || undefined);
  return { ok: true };
}

/** An editor locks a thread (no new posts) or hides it altogether. */
export function moderateThread(editor: User, id: number, action: "lock" | "unlock" | "hide" | "show", acc: DatabaseSync = accountsDb()): { ok: true } | Fail {
  if (!isEditor(editor)) return no("forbidden");
  if (!acc.prepare("SELECT 1 x FROM forum_threads WHERE id = ?").get(id)) return no("not_found");
  const set = { lock: "locked = 1", unlock: "locked = 0", hide: "hidden = 1", show: "hidden = 0" }[action];
  acc.prepare(`UPDATE forum_threads SET ${set} WHERE id = ?`).run(id);
  audit(acc, editor.username, `forum_thread_${action}`, `thread#${id}`);
  return { ok: true };
}

/** The editor's queue: posts with open reports, most reported first, with the words and who wrote them. */
export function reportQueue(editor: User, acc: DatabaseSync = accountsDb()): { ok: true; items: { postId: number; threadId: number; body: string; author: string | null; status: string; reports: number; reasons: string[]; createdAt: string }[] } | Fail {
  if (!isEditor(editor)) return no("forbidden");
  const rows = acc.prepare(
    `SELECT p.id, p.thread_id, p.body, p.status, p.created_at, u.username AS author, COUNT(r.id) AS n, GROUP_CONCAT(DISTINCT r.reason) AS reasons
     FROM forum_reports r JOIN forum_posts p ON p.id = r.post_id LEFT JOIN users u ON u.id = p.user_id WHERE r.status = 'open'
     GROUP BY p.id ORDER BY n DESC, p.id LIMIT 100`).all() as { id: number; thread_id: number; body: string; status: string; created_at: string; author: string | null; n: number; reasons: string }[];
  return { ok: true, items: rows.map((r) => ({ postId: r.id, threadId: r.thread_id, body: r.body, author: r.author, status: r.status, reports: r.n, reasons: r.reasons.split(","), createdAt: r.created_at })) };
}

/** What deleting an account does to what the person wrote: the words are wiped (the places stay, so replies still read), and notes on reports are cleared. */
export function eraseForumFor(userId: number, acc: DatabaseSync = accountsDb()): void {
  acc.prepare("UPDATE forum_posts SET body = '', fingerprint = '', status = 'deleted' WHERE user_id = ?").run(userId);
  acc.prepare("UPDATE forum_reports SET note = NULL WHERE user_id = ?").run(userId);
}
