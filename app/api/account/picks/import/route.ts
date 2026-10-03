import { getDb } from "@/lib/db";
import { importPicks } from "@/lib/accounts/picks";
import { fail, json, postBody, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/** Moves the picks a visitor made before signing in onto their account: {picks: {boutId: boxerId}}. Open bouts only; never overwrites. */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const picks = r.body.picks;
  if (!picks || typeof picks !== "object" || Array.isArray(picks)) return fail("bad_request");
  return json(importPicks(user.id, picks as Record<string, unknown>, await getDb()));
}
