import { postBody, userOf } from "@/lib/accounts/api";
import { appealPost } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** POST: the author of a post that reports hid asks the editors to review it (once per post; a few a day). Signed in; only your own post. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const res = appealPost(user, Number((await ctx.params).id));
  return res.ok ? forumJson({ ok: true }, 201) : forumFail(res.error);
}
