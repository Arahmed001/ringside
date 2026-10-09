import type { DatabaseSync } from "node:sqlite";
import { accountsDb, accountsDbIfAny, audit, nowIso } from "../accounts/store";
import type { User } from "../accounts/users";
import { parsePost, PROVIDER_NAME, type Provider } from "./post";

export type SubjectKind = "boxer" | "event" | "general";
export interface SocialPost { id: number; provider: Provider; postId: string; url: string; embed: string; subjectKind: SubjectKind; subjectExt: string | null; account: string | null; note: string | null; addedAt: string }
export type SocialError = "forbidden" | "bad_link" | "bad_subject" | "duplicate" | "not_found" | "too_many";

export const MAX_PER_SUBJECT = 6, MAX_NOTE = 140, MAX_ACCOUNT = 60;
const isEditor = (u: User) => u.role === "editor" || u.role === "admin";

type Row = { id: number; provider: Provider; post_id: string; url: string; subject_kind: SubjectKind; subject_ext: string | null; account: string | null; note: string | null; added_at: string };
const toPost = (r: Row): SocialPost => {
  const p = parsePost(r.url); // the embed address is rebuilt from the stored link each time, never stored
  return { id: r.id, provider: r.provider, postId: r.post_id, url: r.url, embed: p?.embed ?? "", subjectKind: r.subject_kind, subjectExt: r.subject_ext, account: r.account, note: r.note, addedAt: r.added_at };
};

/** An editor adds a post. `subjectExt` is a fighter's slug or a card's number for those kinds, and empty for the news page. */
export function addPost(user: User, input: { link: unknown; subjectKind: unknown; subjectExt?: unknown; account?: unknown; note?: unknown }, db: DatabaseSync = accountsDb()): { ok: true; post: SocialPost } | { ok: false; error: SocialError } {
  if (!isEditor(user)) return { ok: false, error: "forbidden" };
  const parsed = typeof input.link === "string" ? parsePost(input.link) : null;
  if (!parsed) return { ok: false, error: "bad_link" };
  const kind = input.subjectKind as SubjectKind;
  if (!["boxer", "event", "general"].includes(kind)) return { ok: false, error: "bad_subject" };
  const ext = kind === "general" ? null : typeof input.subjectExt === "string" ? input.subjectExt.trim() : "";
  if (kind === "boxer" && !/^[a-z0-9][a-z0-9-]{0,120}$/.test(ext ?? "")) return { ok: false, error: "bad_subject" };
  if (kind === "event" && !/^\d{1,9}$/.test(ext ?? "")) return { ok: false, error: "bad_subject" };
  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f​‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "") || null;
  const account = clean(input.account, MAX_ACCOUNT) ?? parsed.account, note = clean(input.note, MAX_NOTE);
  const held = (db.prepare("SELECT COUNT(*) c FROM social_posts WHERE subject_kind = ? AND COALESCE(subject_ext, '') = ?").get(kind, ext ?? "") as { c: number }).c;
  if (held >= MAX_PER_SUBJECT) return { ok: false, error: "too_many" };
  try {
    const r = db.prepare("INSERT INTO social_posts (provider, post_id, url, subject_kind, subject_ext, account, note, added_by, added_at) VALUES (?,?,?,?,?,?,?,?,?)").run(parsed.provider, parsed.id, parsed.url, kind, ext, account, note, user.id, nowIso());
    audit(db, user.username, "social_add", `social#${r.lastInsertRowid}`, `${PROVIDER_NAME[parsed.provider]} post on ${kind}${ext ? ` ${ext}` : ""}`);
    return { ok: true, post: toPost(db.prepare("SELECT * FROM social_posts WHERE id = ?").get(r.lastInsertRowid) as Row) };
  } catch (e) {
    if (/UNIQUE/i.test((e as Error).message)) return { ok: false, error: "duplicate" };
    throw e;
  }
}

export function removePost(user: User, id: number, db: DatabaseSync = accountsDb()): { ok: true } | { ok: false; error: SocialError } {
  if (!isEditor(user)) return { ok: false, error: "forbidden" };
  const r = db.prepare("DELETE FROM social_posts WHERE id = ?").run(id);
  if (!r.changes) return { ok: false, error: "not_found" };
  audit(db, user.username, "social_remove", `social#${id}`);
  return { ok: true };
}

export function listAll(db: DatabaseSync = accountsDb(), limit = 200): SocialPost[] {
  return (db.prepare("SELECT * FROM social_posts ORDER BY added_at DESC, id DESC LIMIT ?").all(limit) as Row[]).map(toPost);
}

/** The posts shown for a fighter (slug), a card (id) or the news page; none if there is no accounts database yet. */
export function postsFor(kind: SubjectKind, ext: string | null, db: DatabaseSync | null = accountsDbIfAny()): SocialPost[] {
  if (!db) return [];
  try { return (db.prepare("SELECT * FROM social_posts WHERE subject_kind = ? AND COALESCE(subject_ext, '') = ? ORDER BY added_at DESC, id DESC LIMIT ?").all(kind, ext ?? "", MAX_PER_SUBJECT) as Row[]).map(toPost).filter((p) => p.embed); }
  catch { return []; }
}
