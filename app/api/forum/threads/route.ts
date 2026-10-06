import { postBody, userOf } from "@/lib/accounts/api";
import { accountsDbIfAny } from "@/lib/accounts/store";
import { listThreads, startThread } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** The general board: GET ?page=1 lists threads, newest activity first. POST {title, body} starts one (signed in). */
export async function GET(req: Request) {
  const acc = accountsDbIfAny();
  return forumJson(acc ? listThreads(Number(new URL(req.url).searchParams.get("page")) || 1, acc) : { threads: [], total: 0, pages: 1, page: 1 });
}
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const res = startThread(user, r.body.title, r.body.body, r.ip);
  return res.ok ? forumJson({ threadId: res.threadId, postId: res.postId }, 201) : forumFail(res.error);
}
