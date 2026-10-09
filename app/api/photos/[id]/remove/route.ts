import { postBody, userOf, json, fail } from "@/lib/accounts/api";
import { clearPhoto, removePhoto } from "@/lib/photos/store";
import { getDb } from "@/lib/db";

/** Editors and admins: remove a record, and the picture it put on the fighter's page. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  const h = { "x-robots-tag": "noindex, nofollow" };
  if (!user) return fail("unauthorized", 401, h);
  const res = removePhoto(user, Number((await ctx.params).id));
  if (res.ok) clearPhoto(res.slug, await getDb());
  return res.ok ? json({ ok: true }, 200, h) : fail(res.error, res.error === "forbidden" ? 403 : 404, h);
}
