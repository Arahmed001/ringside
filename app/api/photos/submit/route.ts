import { fail, json, userOf } from "@/lib/accounts/api";
import { clientId, limits, sameOrigin } from "@/lib/accounts/guard";
import { MAX_PHOTO_BYTES } from "@/lib/photos/upload";
import { mySubmissions, submitPhoto, withdrawSubmission } from "@/lib/photos/submissions";
import { getDb } from "@/lib/db";

const H = { "x-robots-tag": "noindex, nofollow" };
const STATUS: Record<string, number> = { too_large: 413, too_many_yours: 429, too_many_for_fighter: 429, duplicate: 409 };

/** Signed-in people: GET lists the pictures you sent. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, H);
  return json({ items: mySubmissions(user, await getDb()) }, 200, H);
}

/** Signed-in people: POST a form (fields: slug, relation, credit, note?, confirm, and the picture as `file`, JPEG or PNG up to 4 MB). It waits for an editor. DELETE {id} withdraws one still waiting. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("forbidden", 403, H);
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, H);
  const declared = Number(req.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_PHOTO_BYTES + 16 * 1024) return fail("too_large", 413, H);
  if (!/^multipart\/form-data/i.test(req.headers.get("content-type") ?? "")) return fail("bad_request", 400, H);
  if (!limits().write.take(`u${user.id}`) || !limits().write.take(`ip${clientId(req.headers)}`)) return fail("rate_limited", 429, H);
  let form: FormData;
  try { form = await req.formData(); } catch { return fail("bad_request", 400, H); }
  const file = form.get("file");
  if (!(file instanceof File)) return fail("empty", 400, H);
  if (file.size > MAX_PHOTO_BYTES) return fail("too_large", 413, H);
  const res = submitPhoto(user, { slug: form.get("slug"), file: new Uint8Array(await file.arrayBuffer()), relation: form.get("relation"), credit: form.get("credit"), note: form.get("note"), confirm: form.get("confirm") }, await getDb());
  if (!res.ok) return fail(res.error, STATUS[res.error] ?? 400, H);
  return json({ id: res.id }, 201, H);
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return fail("forbidden", 403, H);
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, H);
  let id = 0;
  try { id = Number(((await req.json()) as { id?: unknown }).id); } catch { return fail("bad_request", 400, H); }
  return withdrawSubmission(user, id) ? json({ ok: true }, 200, H) : fail("not_found", 404, H);
}
