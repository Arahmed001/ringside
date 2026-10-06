import { postBody, userOf } from "@/lib/accounts/api";
import { reportPost } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** POST {reason: "spam" | "abuse" | "off_topic" | "other", note?}: report a post. Signed in; not your own; once per post. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const res = reportPost(user, Number((await ctx.params).id), r.body.reason, r.body.note);
  return res.ok ? forumJson({ ok: true, hidden: res.hidden }, 201) : forumFail(res.error);
}
