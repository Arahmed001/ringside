import { getDb } from "@/lib/db";
import { userOf } from "@/lib/accounts/api";
import { recentForEditors, whereIs } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** Editors and admins: the newest posts (hidden ones too, with their words) and the threads that are hidden. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const res = recentForEditors(user);
  if (!res.ok) return forumFail(res.error);
  const main = await getDb();
  return forumJson({ posts: res.posts.map((i) => ({ ...i, where: whereIs(main, i) })), hiddenThreads: res.hiddenThreads });
}
