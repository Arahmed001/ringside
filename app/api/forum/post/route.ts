import { getDb } from "@/lib/db";
import { postBody, str, userOf } from "@/lib/accounts/api";
import { addPost } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** Write a post: POST {kind: "boxer" | "bout", subject, body} under a fighter or a fight, or {threadId, body} into a thread. Signed in. */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return forumFail("unauthorized");
  const b = r.body, main = await getDb();
  const target = b.threadId !== undefined ? { threadId: Number(b.threadId) } : b.kind === "boxer" || b.kind === "bout" ? { kind: b.kind as "boxer" | "bout", subject: str(b.subject, 160) } : null;
  if (!target || ("threadId" in target && !Number.isInteger(target.threadId))) return forumFail("not_found");
  const res = addPost(user, target, b.body, r.ip, main);
  return res.ok ? forumJson({ id: res.id, threadId: res.threadId }, 201) : forumFail(res.error);
}
