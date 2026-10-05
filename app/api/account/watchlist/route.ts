import { getDb } from "@/lib/db";
import { addWatch, listWatch, removeWatch } from "@/lib/accounts/watchlist";
import { fail, json, postBody, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/** The signed-in user's watchlist: GET lists the slugs, POST {slug} adds a fighter, DELETE {slug} removes one. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  return json({ slugs: listWatch(user.id, await getDb()) });
}

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const res = addWatch(user.id, String(r.body.slug ?? ""), await getDb());
  return res.ok ? json({ ok: true }) : fail(res.error, res.error === "no_such_boxer" ? 404 : 429);
}

export async function DELETE(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  removeWatch(user.id, String(r.body.slug ?? ""), await getDb());
  return json({ ok: true });
}
