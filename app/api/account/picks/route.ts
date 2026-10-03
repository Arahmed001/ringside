import { getDb } from "@/lib/db";
import { listPicks, removePick, setPick } from "@/lib/accounts/picks";
import { fail, json, postBody, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/** The signed-in user's picks: GET lists them, POST {boutId, boxerId} makes or changes one, DELETE {boutId} removes one. Locked once fight day begins. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  return json({ picks: listPicks(user.id, await getDb()) });
}

const status = { no_such_bout: 404, locked: 409, not_in_bout: 400, too_many: 429 } as const;

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const res = setPick(user.id, Number(r.body.boutId), Number(r.body.boxerId), await getDb());
  return res.ok ? json({ ok: true }) : fail(res.error, status[res.error]);
}

export async function DELETE(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const res = removePick(user.id, Number(r.body.boutId), await getDb());
  return res.ok ? json({ ok: true }) : fail(res.error, status[res.error]);
}
