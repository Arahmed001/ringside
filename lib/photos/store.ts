import type { DatabaseSync } from "node:sqlite";
import { accountsDb, audit, nowIso } from "../accounts/store";
import type { User } from "../accounts/users";
import { cleanPhoto, type PhotoClean, type PhotoError, type PhotoInput } from "./rules";

export interface LicensedImage extends PhotoClean { id: number; addedAt: string }
/** What the credit line shows as the place the picture came from, and how a recorded picture is told from the feed's or Commons'. */
export const RECORDED_SOURCE = "Recorded by the editors";
export type PhotoStoreError = PhotoError | "forbidden" | "not_found";
const isEditor = (u: User) => u.role === "editor" || u.role === "admin";
type Row = { id: number; boxer_slug: string; image_url: string; licence: string; licence_url: string | null; credit: string; source_url: string; evidence: string | null; added_at: string };
const toImage = (r: Row): LicensedImage => ({ id: r.id, slug: r.boxer_slug, imageUrl: r.image_url, licence: r.licence as LicensedImage["licence"], licenceUrl: r.licence_url, credit: r.credit, sourceUrl: r.source_url, evidence: r.evidence, addedAt: r.added_at });

/** Records (or replaces) the picture of one fighter. Only an editor; the record must pass `cleanPhoto`. */
export function savePhoto(user: User, input: PhotoInput, db: DatabaseSync = accountsDb()): { ok: true; image: LicensedImage } | { ok: false; error: PhotoStoreError } {
  if (!isEditor(user)) return { ok: false, error: "forbidden" };
  const c = cleanPhoto(input);
  if (!c.ok) return c;
  const p = c.photo;
  db.prepare(`INSERT INTO licensed_images (boxer_slug, image_url, licence, licence_url, credit, source_url, evidence, added_by, added_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(boxer_slug) DO UPDATE SET image_url = excluded.image_url, licence = excluded.licence, licence_url = excluded.licence_url, credit = excluded.credit, source_url = excluded.source_url, evidence = excluded.evidence, added_by = excluded.added_by, added_at = excluded.added_at`)
    .run(p.slug, p.imageUrl, p.licence, p.licenceUrl, p.credit, p.sourceUrl, p.evidence, user.id, nowIso());
  audit(db, user.username, "photo_save", `boxer:${p.slug}`, `${p.licence}; ${p.credit}`);
  return { ok: true, image: toImage(db.prepare("SELECT * FROM licensed_images WHERE boxer_slug = ?").get(p.slug) as Row) };
}

export function removePhoto(user: User, id: number, db: DatabaseSync = accountsDb()): { ok: true; slug: string } | { ok: false; error: PhotoStoreError } {
  if (!isEditor(user)) return { ok: false, error: "forbidden" };
  const row = db.prepare("SELECT boxer_slug FROM licensed_images WHERE id = ?").get(id) as { boxer_slug: string } | undefined;
  if (!row) return { ok: false, error: "not_found" };
  db.prepare("DELETE FROM licensed_images WHERE id = ?").run(id);
  audit(db, user.username, "photo_remove", `boxer:${row.boxer_slug}`);
  return { ok: true, slug: row.boxer_slug };
}

export const listPhotos = (db: DatabaseSync = accountsDb()): LicensedImage[] => (db.prepare("SELECT * FROM licensed_images ORDER BY added_at DESC, id DESC").all() as Row[]).map(toImage);

/**
 * Puts every recorded picture onto its fighter in the sports database: a fighter with no photo, or one whose photo came from Wikimedia Commons or from an earlier record, takes the
 * recorded one with its licence and credit. A photo that came with the supplier's feed (which carries its own licence) is never replaced. Returns what it did.
 */
export function applyPhotos(images: LicensedImage[], main: DatabaseSync): { applied: number; unknown: string[]; kept: string[] } {
  const out = { applied: 0, unknown: [] as string[], kept: [] as string[] };
  const find = main.prepare("SELECT id, photo_url, photo_credit FROM boxers WHERE slug = ?"), set = main.prepare("UPDATE boxers SET photo_url = ?, photo_credit = ? WHERE id = ?");
  for (const im of images) {
    const b = find.get(im.slug) as { id: number; photo_url: string | null; photo_credit: string | null } | undefined;
    if (!b) { out.unknown.push(im.slug); continue; }
    let source = ""; try { source = (JSON.parse(b.photo_credit ?? "null") as { source?: string } | null)?.source ?? ""; } catch { /* unreadable credit: treat as the feed's */ }
    if (b.photo_url && source !== "Wikimedia Commons" && source !== RECORDED_SOURCE) { out.kept.push(im.slug); continue; }
    set.run(im.imageUrl, JSON.stringify({ text: `${im.credit}, ${im.licence}`, license: im.licence, licenseUrl: im.licenceUrl, pageUrl: im.sourceUrl, source: RECORDED_SOURCE }), b.id);
    out.applied++;
  }
  return out;
}

/** Takes a recorded picture off the fighter's page (only one that came from a record: a photo from the feed or Commons is not touched). */
export function clearPhoto(slug: string, main: DatabaseSync): boolean {
  return Number(main.prepare("UPDATE boxers SET photo_url = NULL, photo_credit = NULL WHERE slug = ? AND photo_credit LIKE '%\"source\":\"" + RECORDED_SOURCE + "\"%'").run(slug).changes) > 0;
}
