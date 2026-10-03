import { fail, userOf } from "@/lib/accounts/api";
import { accountsDb } from "@/lib/accounts/store";
import { exportFor } from "@/lib/accounts/export";

/**
 * Everything held about the signed-in person, as a download: profile, devices, picks, proposals, reports (with the contact given), linked fighters and the
 * activity log entries that name them (lib/accounts/export.ts). Not the password hash or any session token.
 */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  return new Response(JSON.stringify(exportFor(user, accountsDb()), null, 1), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="ringside-my-data.json"', "cache-control": "no-store" } });
}
