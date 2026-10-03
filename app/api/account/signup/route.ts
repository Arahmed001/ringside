import { createUser, createSession } from "@/lib/accounts/users";
import { fail, json, postBody, sessionCookie, str } from "@/lib/accounts/api";
import { hashingAllowed, limits } from "@/lib/accounts/guard";

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  if (!limits().signup.take(r.ip) || !hashingAllowed()) return fail("rate_limited", 429, { "retry-after": "3600" });
  const made = await createUser(str(r.body.username, 40), str(r.body.password, 400));
  if ("error" in made) return fail(made.error, 400);
  const s = createSession(made.user.id);
  return json({ user: made.user }, 201, { "set-cookie": sessionCookie(req, s.token, s.expires) });
}
