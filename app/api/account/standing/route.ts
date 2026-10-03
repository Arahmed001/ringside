import { getDb } from "@/lib/db";
import { getWorld } from "@/lib/world";
import { getTFor } from "@/lib/i18n/dicts";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/config";
import { markRecapSeen, myStanding, picksRecap } from "@/lib/accounts/leaderboard";
import { fail, json, postBody, str, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/** The signed-in person's own pick'em standing and what was graded since they last looked: GET ?lang=ar. POST {through} says they have seen the recap up to that fight date. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  const lang = new URL(req.url).searchParams.get("lang");
  const t = await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE);
  const [main, w] = [await getDb(), await getWorld()];
  return json({ standing: myStanding(main, w, t, user.id), recap: picksRecap(main, w, t, user.id) });
}

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  markRecapSeen(user.id, str(r.body.through, 10));
  return json({ ok: true });
}
