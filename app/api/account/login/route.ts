import { checkLogin, createSession } from "@/lib/accounts/users";
import { fail, json, postBody, sessionCookie, str } from "@/lib/accounts/api";
import { hashingAllowed, limits } from "@/lib/accounts/guard";

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const name = str(r.body.username, 40).toLowerCase();
  const key = `login:${name}`; // its own namespace: the limiter also holds `pw:<id>`, `del:<id>` and `reset:<name>`, which a typed username must never be able to name
  const l = limits();
  // refuse before doing any hashing work once either window is used up; count the attempt either way, forgive it on success
  if (l.loginIp.left(r.ip) === 0 || l.loginName.left(key) === 0 || !hashingAllowed()) return fail("rate_limited", 429, { "retry-after": "900" });
  l.loginIp.take(r.ip); l.loginName.take(key);
  const user = await checkLogin(name, str(r.body.password, 400));
  if (!user) return fail("bad_login", 401);
  l.loginName.clear(key);
  const s = createSession(user.id, undefined, undefined, req.headers.get("user-agent"));
  return json({ user }, 200, { "set-cookie": sessionCookie(req, s.token, s.expires) });
}
