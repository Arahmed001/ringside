import { postBody, userOf, json, fail } from "@/lib/accounts/api";
import { removePost } from "@/lib/social/store";

/** Editors and admins: remove a post at once. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, { "x-robots-tag": "noindex, nofollow" });
  const res = removePost(user, Number((await ctx.params).id));
  return res.ok ? json({ ok: true }, 200, { "x-robots-tag": "noindex, nofollow" }) : fail(res.error, res.error === "forbidden" ? 403 : 404, { "x-robots-tag": "noindex, nofollow" });
}
