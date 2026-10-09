import { postBody, userOf, json, fail, canReview } from "@/lib/accounts/api";
import { addPost, listAll } from "@/lib/social/store";

const STATUS: Record<string, number> = { forbidden: 403, bad_link: 400, bad_subject: 400, duplicate: 409, not_found: 404, too_many: 409 };
const NOINDEX = { "x-robots-tag": "noindex, nofollow" };

/** Editors and admins: the posts that have been added. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, NOINDEX);
  if (!canReview(user)) return fail("forbidden", 403, NOINDEX);
  return json({ posts: listAll() }, 200, NOINDEX);
}

/** Editors and admins: POST {link, subjectKind: "boxer" | "event" | "general", subjectExt?, account?, note?}. */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401, NOINDEX);
  const res = addPost(user, { link: r.body.link, subjectKind: r.body.subjectKind, subjectExt: r.body.subjectExt, account: r.body.account, note: r.body.note });
  return res.ok ? json({ post: res.post }, 200, NOINDEX) : fail(res.error, STATUS[res.error] ?? 400, NOINDEX);
}
