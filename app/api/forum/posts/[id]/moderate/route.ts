import { postBody, userOf } from "@/lib/accounts/api";
import { moderatePost } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** Editors and admins: POST {action: "hide" | "restore" | "confirm", reason?} ("confirm" keeps a hidden post hidden: it settles an appeal). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const action = r.body.action === "hide" || r.body.action === "restore" || r.body.action === "confirm" ? r.body.action : null;
  if (!action) return forumFail("bad_reason");
  const res = moderatePost(user, Number((await ctx.params).id), action, r.body.reason);
  return res.ok ? forumJson({ ok: true }) : forumFail(res.error);
}
