import { createSession, redeemResetCode } from "@/lib/accounts/users";
import { fail, json, postBody, sessionCookie, str } from "@/lib/accounts/api";
import { hashingAllowed, limits } from "@/lib/accounts/guard";

/** Sets a new password with a one-time code the operator issued (`npm run accounts -- reset NAME`). */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const name = str(r.body.username, 40).toLowerCase();
  const l = limits();
  if (l.loginIp.left(r.ip) === 0 || l.loginName.left(`reset:${name}`) === 0 || !hashingAllowed()) return fail("rate_limited", 429);
  l.loginIp.take(r.ip); l.loginName.take(`reset:${name}`);
  const res = await redeemResetCode(name, str(r.body.code, 100), str(r.body.password, 400));
  if (res !== "ok") return fail(res, 400);
  const user = (await import("@/lib/accounts/store")).accountsDb().prepare("SELECT id FROM users WHERE username = ?").get(name) as { id: number };
  const s = createSession(user.id, undefined, undefined, req.headers.get("user-agent"));
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(req, s.token, s.expires) });
}
