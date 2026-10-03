import { getDb, bumpDbVersion } from "@/lib/db";
import { recomputeRatings } from "@/lib/ingest";
import { reviewReport, settleFlagged } from "@/lib/accounts/corrections";
import { canReview, fail, json, postBody, str, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

const status = { not_found: 404, not_open: 409, own: 403, note_required: 400, forbidden: 403, not_a_correction: 409 } as const;

/**
 * {decision: "accepted" | "rejected", note} for an open report; {action: "keep" | "retire", note} for a correction the vendor has changed under.
 * Accepting applies the correction at once; a changed result or method recomputes the ratings.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!canReview(user)) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const id = Number((await ctx.params).id), db = await getDb(), note = str(r.body.note, 600);
  const { decision, action } = r.body;
  let res;
  if (decision === "accepted" || decision === "rejected") res = reviewReport(user, id, decision, note, db);
  else if (action === "keep" || action === "retire") res = settleFlagged(user, id, action, note, db);
  else return fail("bad_request");
  if (!res.ok) return fail(res.error, status[res.error]);
  if (res.applied.boutsChanged) recomputeRatings(db);
  bumpDbVersion(); // the world rebuilds on the next request, so pages show the correction at once
  return json({ ok: true, applied: res.applied.applied, vendorChanged: res.applied.vendorChanged });
}
