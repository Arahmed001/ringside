import { changePassword, createSession } from "@/lib/accounts/users";
import { fail, json, postBody, sessionCookie, str, userOf } from "@/lib/accounts/api";
import { hashingAllowed, limits } from "@/lib/accounts/guard";

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().loginName.take(`pw:${user.id}`) || !hashingAllowed()) return fail("rate_limited", 429);
  const res = await changePassword(user.id, str(r.body.current, 400), str(r.body.next, 400));
  if (res === "wrong_password") return fail("wrong_password", 400);
  if (res !== "ok") return fail(res, 400);
  limits().loginName.clear(`pw:${user.id}`);
  const s = createSession(user.id); // every other device was signed out; this one continues
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(req, s.token, s.expires) });
}
