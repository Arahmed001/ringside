import { userOf } from "@/lib/accounts/api";
import { reportQueue } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** Editors and admins: the posts with open reports, most reported first. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const res = reportQueue(user);
  return res.ok ? forumJson({ items: res.items }) : forumFail(res.error);
}
