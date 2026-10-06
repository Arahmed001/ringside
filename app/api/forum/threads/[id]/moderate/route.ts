import { postBody, userOf } from "@/lib/accounts/api";
import { moderateThread } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** Editors and admins: POST {action: "lock" | "unlock" | "hide" | "show"}. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const a = r.body.action;
  if (a !== "lock" && a !== "unlock" && a !== "hide" && a !== "show") return forumFail("bad_reason");
  const res = moderateThread(user, Number((await ctx.params).id), a);
  return res.ok ? forumJson({ ok: true }) : forumFail(res.error);
}
