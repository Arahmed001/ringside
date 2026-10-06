import { getDb } from "@/lib/db";
import { userOf } from "@/lib/accounts/api";
import { findSubjectThread, getThread, listPosts } from "@/lib/forum/posts";
import { forumFail, forumJson } from "@/lib/forum/http";

/** One thread and a page of its posts: GET /api/forum/thread?kind=boxer&subject=some-name (or kind=bout&subject=42, or id=7), optionally &after=<post id>. Public to read. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams, viewer = userOf(req), after = Number(sp.get("after")) || 0;
  const id = sp.get("id");
  const kind = sp.get("kind");
  const thread = id ? getThread(Number(id)) : kind === "boxer" || kind === "bout" ? findSubjectThread(await getDb(), kind, sp.get("subject") ?? "") : null;
  if (id && !thread) return forumFail("not_found");
  if (!thread) return forumJson({ thread: null, posts: [], more: false, signedIn: !!viewer, role: viewer?.role ?? null });
  return forumJson({ thread, ...listPosts(thread.id, viewer, after), signedIn: !!viewer, role: viewer?.role ?? null });
}
