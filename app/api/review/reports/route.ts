import { getDb } from "@/lib/db";
import { reportQueue, type QueueKind } from "@/lib/accounts/corrections";
import { canReview, fail, json, userOf } from "@/lib/accounts/api";

/** The reports queue for editors and admins: ?kind=error (default) | flagged | about_me (admins only), and ?status=open (default) | accepted | rejected | withdrawn. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!canReview(user)) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") as QueueKind | null;
  if (kind === "about_me" && user.role !== "admin") return fail("forbidden", 403);
  return json({ items: reportQueue(user, await getDb(), { kind: kind ?? "error", status: q.get("status") ?? "open" }) });
}
