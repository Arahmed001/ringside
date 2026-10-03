import { checkLogin, createSession } from "@/lib/accounts/users";
import { fail, json, postBody, sessionCookie, str } from "@/lib/accounts/api";
import { hashingAllowed, limits } from "@/lib/accounts/guard";

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const name = str(r.body.username, 40).toLowerCase();
  const l = limits();
  // refuse before doing any hashing work once either window is used up; count the attempt either way, forgive it on success
  if (l.loginIp.left(r.ip) === 0 || l.loginName.left(name) === 0 || !hashingAllowed()) return fail("rate_limited", 429, { "retry-after": "900" });
  l.loginIp.take(r.ip); l.loginName.take(name);
  const user = await checkLogin(name, str(r.body.password, 400));
  if (!user) return fail("bad_login", 401);
  l.loginName.clear(name);
  const s = createSession(user.id);
  return json({ user }, 200, { "set-cookie": sessionCookie(req, s.token, s.expires) });
}
