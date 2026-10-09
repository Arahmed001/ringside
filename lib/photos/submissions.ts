import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { accountsDb, accountsPath, audit, nowIso } from "../accounts/store";
import type { User } from "../accounts/users";
import { applyPhotos, savePhoto, type LicensedImage } from "./store";
import { cleanUpload, type UploadError } from "./upload";

/**
 * Pictures sent in through the site. Anyone signed in can send one for a fighter, saying who they are to the picture (the fighter, their team, the photographer, or someone else) and
 * confirming that they took it or have the owner's permission. Nothing is shown until an editor approves it; approving records it as a picture "by permission" with the sender as the
 * evidence, and puts it on the fighter's page. The file is kept on the server's own disk, in the photos folder beside the accounts database, with its metadata stripped.
 */
export const RELATIONS = ["self", "team", "photographer", "other"] as const;
export type Relation = (typeof RELATIONS)[number];
export type SubmitError = UploadError | "boxer_unknown" | "no_credit" | "bad_relation" | "no_confirm" | "too_many_yours" | "too_many_for_fighter" | "duplicate";
export type ReviewError = "forbidden" | "not_found" | "not_pending" | "own_submission" | "bad_action" | "bad_slug" | "bad_image" | "bad_licence" | "no_credit" | "bad_source" | "no_evidence" | "file_missing";
export const MAX_PENDING_PER_USER = 3, MAX_PENDING_PER_BOXER = 5;
export const photoDir = () => path.join(path.dirname(accountsPath()), "photos");
const isEditor = (u: User) => u.role === "editor" || u.role === "admin";
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f-\u009f​‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

export interface SubmissionInput { slug: unknown; file: Uint8Array; relation: unknown; credit: unknown; note?: unknown; confirm: unknown }
export interface SubmissionView {
  id: number; status: string; slug: string; fileName: string; imageUrl: string; width: number; height: number; bytes: number; relation: Relation; credit: string; note: string | null;
  createdAt: string; sender: string | null; senderIsOwner: boolean; reviewedAt: string | null; reviewNote: string | null;
}
type Row = { id: number; user_id: number | null; boxer_slug: string; file_name: string; width: number; height: number; bytes: number; relation: string; credit: string; note: string | null; status: string; created_at: string; reviewed_at: string | null; review_note: string | null };

export function submitPhoto(user: User, input: SubmissionInput, main: DatabaseSync, acc: DatabaseSync = accountsDb(), dir = photoDir()): { ok: true; id: number } | { ok: false; error: SubmitError } {
  const err = (error: SubmitError) => ({ ok: false as const, error });
  const slug = clean(input.slug, 120).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(slug) || !main.prepare("SELECT 1 x FROM boxers WHERE slug = ?").get(slug)) return err("boxer_unknown");
  const relation = RELATIONS.find((r) => r === input.relation);
  if (!relation) return err("bad_relation");
  const credit = clean(input.credit, 160);
  if (credit.length < 3) return err("no_credit");
  if (input.confirm !== true && input.confirm !== "true" && input.confirm !== "on") return err("no_confirm");
  const note = clean(input.note, 500) || null;
  if ((acc.prepare("SELECT count(*) n FROM photo_submissions WHERE user_id = ? AND status = 'pending'").get(user.id) as { n: number }).n >= MAX_PENDING_PER_USER) return err("too_many_yours");
  if ((acc.prepare("SELECT count(*) n FROM photo_submissions WHERE boxer_slug = ? AND status = 'pending'").get(slug) as { n: number }).n >= MAX_PENDING_PER_BOXER) return err("too_many_for_fighter");
  const c = cleanUpload(input.file);
  if (!c.ok) return err(c.error);
  const p = c.photo, fileName = `${createHash("sha256").update(p.bytes).digest("hex").slice(0, 32)}.${p.ext}`;
  if (acc.prepare("SELECT 1 x FROM photo_submissions WHERE file_name = ? AND boxer_slug = ? AND status IN ('pending','approved')").get(fileName, slug)) return err("duplicate");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, fileName);
  if (!fs.existsSync(target)) fs.writeFileSync(target, p.bytes, { flag: "wx", mode: 0o640 });
  const r = acc.prepare("INSERT INTO photo_submissions (user_id, boxer_slug, file_name, width, height, bytes, relation, credit, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id")
    .get(user.id, slug, fileName, p.width, p.height, p.bytes.length, relation, credit, note, nowIso()) as { id: number };
  audit(acc, user.username, "photo_submit", `boxer:${slug}`, `${relation}; ${p.bytes.length} bytes`);
  return { ok: true, id: r.id };
}

function toView(r: Row, acc: DatabaseSync, main: DatabaseSync): SubmissionView {
  const sender = r.user_id ? (acc.prepare("SELECT username FROM users WHERE id = ?").get(r.user_id) as { username: string } | undefined)?.username ?? null : null;
  const ext = (main.prepare("SELECT external_id e FROM boxers WHERE slug = ?").get(r.boxer_slug) as { e: string } | undefined)?.e;
  const owner = !!(r.user_id && ext && acc.prepare("SELECT 1 x FROM boxer_owners WHERE user_id = ? AND boxer_ext = ?").get(r.user_id, ext));
  return { id: r.id, status: r.status, slug: r.boxer_slug, fileName: r.file_name, imageUrl: `/api/photo-file/${r.file_name}`, width: r.width, height: r.height, bytes: r.bytes, relation: r.relation as Relation, credit: r.credit, note: r.note, createdAt: r.created_at, sender, senderIsOwner: owner, reviewedAt: r.reviewed_at, reviewNote: r.review_note };
}

/** Editors: the pictures waiting (oldest first), or recently decided ones. */
export function listSubmissions(main: DatabaseSync, status: "pending" | "decided" = "pending", acc: DatabaseSync = accountsDb()): SubmissionView[] {
  const rows = (status === "pending"
    ? acc.prepare("SELECT * FROM photo_submissions WHERE status = 'pending' ORDER BY created_at, id LIMIT 200")
    : acc.prepare("SELECT * FROM photo_submissions WHERE status != 'pending' ORDER BY coalesce(reviewed_at, created_at) DESC, id DESC LIMIT 50")).all() as Row[];
  return rows.map((r) => toView(r, acc, main));
}

/** A person's own submissions, newest first. */
export function mySubmissions(user: User, main: DatabaseSync, acc: DatabaseSync = accountsDb()): SubmissionView[] {
  return (acc.prepare("SELECT * FROM photo_submissions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50").all(user.id) as Row[]).map((r) => toView(r, acc, main));
}

export function withdrawSubmission(user: User, id: number, acc: DatabaseSync = accountsDb(), dir = photoDir()): boolean {
  const r = acc.prepare("UPDATE photo_submissions SET status = 'withdrawn', reviewed_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'").run(nowIso(), id, user.id);
  if (!Number(r.changes)) return false;
  dropUnusedFile(acc, id, dir);
  return true;
}

function dropUnusedFile(acc: DatabaseSync, id: number, dir: string) {
  const row = acc.prepare("SELECT file_name FROM photo_submissions WHERE id = ?").get(id) as { file_name: string } | undefined;
  if (!row) return;
  if (acc.prepare("SELECT 1 x FROM photo_submissions WHERE file_name = ? AND status IN ('pending','approved')").get(row.file_name)) return;
  if (acc.prepare("SELECT 1 x FROM licensed_images WHERE image_url = ?").get(`/api/photo-file/${row.file_name}`)) return;
  try { fs.unlinkSync(path.join(dir, row.file_name)); } catch { /* already gone */ }
}

/** An editor approves (recording the picture by permission and putting it on the fighter's page) or rejects. Nobody but an admin decides on a picture they sent themselves. */
export function reviewSubmission(editor: User, id: number, action: unknown, note: unknown, main: DatabaseSync, acc: DatabaseSync = accountsDb(), dir = photoDir()):
  { ok: true; status: "approved" | "rejected"; applied: boolean; kept: boolean } | { ok: false; error: ReviewError } {
  if (!isEditor(editor)) return { ok: false, error: "forbidden" };
  if (action !== "approve" && action !== "reject") return { ok: false, error: "bad_action" };
  const row = acc.prepare("SELECT * FROM photo_submissions WHERE id = ?").get(id) as Row | undefined;
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "pending") return { ok: false, error: "not_pending" };
  if (row.user_id === editor.id && editor.role !== "admin") return { ok: false, error: "own_submission" };
  const reviewNote = clean(note, 300) || null, now = nowIso();
  if (action === "reject") {
    acc.prepare("UPDATE photo_submissions SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(editor.id, now, reviewNote, id);
    audit(acc, editor.username, "photo_reject", `boxer:${row.boxer_slug}`, reviewNote ?? "");
    dropUnusedFile(acc, id, dir);
    return { ok: true, status: "rejected", applied: false, kept: false };
  }
  if (!fs.existsSync(path.join(dir, row.file_name))) return { ok: false, error: "file_missing" };
  // the evidence does not name the sender: it outlives their account, and the submission row (while it has a sender) says who
  const evidence = `Sent in through the site by a signed-in account (${row.relation === "self" ? "the fighter" : row.relation === "team" ? "the fighter's team" : row.relation === "photographer" ? "the photographer" : "another person"}) on ${row.created_at.slice(0, 10)}, who confirmed they took it or have the owner's permission to show it.`;
  const saved = savePhoto(editor, { slug: row.boxer_slug, imageUrl: `/api/photo-file/${row.file_name}`, licence: "By permission", credit: row.credit, sourceUrl: `/boxers/${row.boxer_slug}`, evidence }, acc);
  if (!saved.ok) return { ok: false, error: saved.error as ReviewError };
  acc.prepare("UPDATE photo_submissions SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(editor.id, now, reviewNote, id);
  audit(acc, editor.username, "photo_approve", `boxer:${row.boxer_slug}`, row.file_name);
  const res = applyPhotos([saved.image as LicensedImage], main);
  return { ok: true, status: "approved", applied: res.applied > 0, kept: res.kept.length > 0 };
}

/** When an account is deleted: its pictures still waiting are withdrawn and their files removed. Approved pictures stay on the fighter's page (the sender chose the credit and gave the permission). */
export function withdrawPendingFor(userId: number, acc: DatabaseSync = accountsDb(), dir = photoDir()): number {
  const ids = (acc.prepare("SELECT id FROM photo_submissions WHERE user_id = ? AND status = 'pending'").all(userId) as { id: number }[]).map((r) => r.id);
  for (const id of ids) { acc.prepare("UPDATE photo_submissions SET status = 'withdrawn', reviewed_at = ?, note = NULL WHERE id = ?").run(nowIso(), id); dropUnusedFile(acc, id, dir); }
  return ids.length;
}

/**
 * Whether a stored picture may be served to this viewer: anyone may see one that is on a fighter's page (recorded and approved); only its sender and the editors may see one still waiting.
 * `name` is checked against the exact file-name shape first, so it can never reach outside the photos folder.
 */
export const FILE_NAME = /^[a-f0-9]{32}\.(jpg|png)$/;
export function canServe(name: string, viewer: User | null, acc: DatabaseSync = accountsDb()): boolean {
  if (!FILE_NAME.test(name)) return false;
  if (acc.prepare("SELECT 1 x FROM licensed_images WHERE image_url = ?").get(`/api/photo-file/${name}`)) return true;
  if (!viewer) return false;
  if (isEditor(viewer)) return !!acc.prepare("SELECT 1 x FROM photo_submissions WHERE file_name = ?").get(name);
  return !!acc.prepare("SELECT 1 x FROM photo_submissions WHERE file_name = ? AND user_id = ?").get(name, viewer.id);
}
