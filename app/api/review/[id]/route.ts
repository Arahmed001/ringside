import { getDb } from "@/lib/db";
import { review } from "@/lib/accounts/contributions";
import { canReview, fail, json, postBody, str, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";
import { bumpDbVersion } from "@/lib/db";

const status = { not_found: 404, not_pending: 409, own: 403, note_required: 400, forbidden: 403 } as const;

/** Approve or reject: {decision: "approved" | "rejected", note}. Approving writes the edit into the database straight away. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!canReview(user)) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const decision = r.body.decision;
  if (decision !== "approved" && decision !== "rejected") return fail("bad_request");
  const res = review(user, Number((await ctx.params).id), decision, str(r.body.note, 600), await getDb());
  if (!res.ok) return fail(res.error, status[res.error]);
  bumpDbVersion(); // the world rebuilds on the next request, so the page shows the edit at once
  return json({ ok: true });
}
