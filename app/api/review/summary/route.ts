import { canReview, fail, json, userOf } from "@/lib/accounts/api";
import { accountsDb } from "@/lib/accounts/store";
import { reviewSummary } from "@/lib/review-summary";

/** Editors and admins: how many items wait on each of the editors' pages. Counts only; nothing from them. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!canReview(user)) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401, { "x-robots-tag": "noindex, nofollow" });
  return json(reviewSummary(accountsDb()), 200, { "x-robots-tag": "noindex, nofollow" });
}
