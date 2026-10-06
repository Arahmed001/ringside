import { getDb } from "@/lib/db";
import { userOf } from "@/lib/accounts/api";
import { reportQueue, whereIs } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** Editors and admins: the posts with open reports, most reported first. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const res = reportQueue(user);
  if (!res.ok) return forumFail(res.error);
  const main = await getDb();
  return forumJson({ items: res.items.map((i) => ({ ...i, where: whereIs(main, i) })) });
}
