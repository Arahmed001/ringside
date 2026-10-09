import { canReview, fail, json, userOf } from "@/lib/accounts/api";
import { listSubmissions } from "@/lib/photos/submissions";
import { getDb } from "@/lib/db";

/** Editors and admins: the pictures sent in that wait for a decision (or, with ?decided=1, the latest decided ones). */
export async function GET(req: Request) {
  const h = { "x-robots-tag": "noindex, nofollow" };
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, h);
  if (!canReview(user)) return fail("forbidden", 403, h);
  return json({ items: listSubmissions(await getDb(), new URL(req.url).searchParams.get("decided") ? "decided" : "pending") }, 200, h);
}
