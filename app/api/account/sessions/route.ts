import { listSessions, revokeOtherSessions, revokeSession } from "@/lib/accounts/users";
import { cookieOf, fail, json, postBody, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/** Where the signed-in person is signed in: GET lists the sessions; POST {action:"revoke", id} ends one, {action:"others"} ends all but this one. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  return json({ sessions: listSessions(user.id, cookieOf(req)) });
}

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  if (r.body.action === "others") return json({ ended: revokeOtherSessions(user.id, cookieOf(req)) });
  if (r.body.action === "revoke") {
    const id = String(r.body.id ?? "");
    if (listSessions(user.id, cookieOf(req)).find((s) => s.id === id)?.current) return fail("this_session", 400); // signing out here has its own button
    return revokeSession(user.id, id) ? json({ ok: true }) : fail("not_found", 404);
  }
  return fail("bad_request");
}
