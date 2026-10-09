import { postBody, userOf, json, fail, canReview } from "@/lib/accounts/api";
import { listPhotos, savePhoto, applyPhotos } from "@/lib/photos/store";
import { getDb } from "@/lib/db";

const STATUS: Record<string, number> = { forbidden: 403, not_found: 404 };
const NOINDEX = { "x-robots-tag": "noindex, nofollow" };

/** Editors and admins: the recorded pictures. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, NOINDEX);
  if (!canReview(user)) return fail("forbidden", 403, NOINDEX);
  return json({ images: listPhotos() }, 200, NOINDEX);
}

/** Editors and admins: POST {slug, imageUrl, licence, credit, sourceUrl, evidence?, licenceUrl?}. A saved record is put on the fighter's page at once. */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, NOINDEX);
  const res = savePhoto(user, { slug: r.body.slug, imageUrl: r.body.imageUrl, licence: r.body.licence, credit: r.body.credit, sourceUrl: r.body.sourceUrl, evidence: r.body.evidence, licenceUrl: r.body.licenceUrl });
  if (!res.ok) return fail(res.error, STATUS[res.error] ?? 400, NOINDEX);
  const applied = applyPhotos([res.image], await getDb());
  return json({ image: res.image, applied: applied.applied, kept: applied.kept, unknown: applied.unknown }, 200, NOINDEX);
}
