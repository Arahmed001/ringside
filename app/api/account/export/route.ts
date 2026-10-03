import { fail, userOf } from "@/lib/accounts/api";
import { accountsDb } from "@/lib/accounts/store";

/** Everything held about the signed-in person, as a download: their profile, picks and contributions. (No password hash, no session tokens.) */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  const db = accountsDb();
  const body = {
    exportedAt: new Date().toISOString(),
    user: { username: user.username, role: user.role, createdAt: user.createdAt, picksPublic: user.picksPublic },
    picks: db.prepare("SELECT bout_ext AS bout, boxer_ext AS pickedBoxer, picked_at AS pickedAt FROM picks WHERE user_id = ? ORDER BY picked_at").all(user.id),
    contributions: db.prepare("SELECT id, status, boxer_ext AS boxer, role, person_name AS person, start_date AS start, end_date AS end, source_url AS sourceUrl, quote, note, created_at AS createdAt, review_note AS reviewNote FROM contributions WHERE user_id = ? ORDER BY id").all(user.id),
  };
  return new Response(JSON.stringify(body, null, 1), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="ringside-my-data.json"', "cache-control": "no-store" } });
}
