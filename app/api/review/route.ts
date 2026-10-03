import { getDb } from "@/lib/db";
import { queue } from "@/lib/accounts/contributions";
import { canReview, fail, json, userOf } from "@/lib/accounts/api";

/** The review queue, for editors and admins: ?status=pending (default) | approved | rejected. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!canReview(user)) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  const s = new URL(req.url).searchParams.get("status");
  return json({ items: queue(await getDb(), s === "approved" || s === "rejected" ? s : "pending") });
}
