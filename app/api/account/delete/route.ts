import { deleteUser } from "@/lib/accounts/users";
import { clearCookie, fail, json, postBody, str, userOf } from "@/lib/accounts/api";
import { hashingAllowed, limits } from "@/lib/accounts/guard";

/** Deletes the account, its picks and its sessions. Needs the password again, so a stolen session cannot do it. */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().loginName.take(`del:${user.id}`) || !hashingAllowed()) return fail("rate_limited", 429);
  if (!(await deleteUser(user.id, str(r.body.password, 400)))) return fail("wrong_password", 400);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(req) });
}
