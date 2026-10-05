import { getDb } from "@/lib/db";
import { importWatch, listWatch } from "@/lib/accounts/watchlist";
import { fail, json, postBody, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/** Moves the fighters a visitor starred before signing in onto their account: {slugs: [...]}. Adds only; answers with the account's whole list. */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  if (!Array.isArray(r.body.slugs)) return fail("bad_request");
  const db = await getDb();
  const res = importWatch(user.id, r.body.slugs, db);
  return json({ ...res, slugs: listWatch(user.id, db) });
}
