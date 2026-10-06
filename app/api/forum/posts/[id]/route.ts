import { postBody, userOf } from "@/lib/accounts/api";
import { deleteOwnPost, editPost } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** PATCH {body}: change your own post (for 15 minutes). DELETE: withdraw your own post (the words are wiped). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const res = editPost(user, Number((await ctx.params).id), r.body.body);
  return res.ok ? forumJson({ ok: true }) : forumFail(res.error);
}
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const res = deleteOwnPost(user, Number((await ctx.params).id));
  return res.ok ? forumJson({ ok: true }) : forumFail(res.error);
}
