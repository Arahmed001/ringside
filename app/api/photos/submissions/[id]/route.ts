import { fail, json, postBody, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";
import { reviewSubmission } from "@/lib/photos/submissions";
import { getDb } from "@/lib/db";

const STATUS: Record<string, number> = { forbidden: 403, not_found: 404, not_pending: 409, own_submission: 403 };

/** Editors and admins: POST {action: "approve" | "reject", note?}. Approving puts the picture on the fighter's page at once. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const h = { "x-robots-tag": "noindex, nofollow" };
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, h);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429, h);
  const res = reviewSubmission(user, Number((await ctx.params).id), r.body.action, r.body.note, await getDb());
  return res.ok ? json(res, 200, h) : fail(res.error, STATUS[res.error] ?? 400, h);
}
