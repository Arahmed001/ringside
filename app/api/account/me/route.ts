import { json, userOf } from "@/lib/accounts/api";
import { accountsDbIfAny } from "@/lib/accounts/store";

/** Who is signed in (or null). Never creates the accounts database just to answer "nobody". */
export async function GET(req: Request) {
  if (!accountsDbIfAny()) return json({ user: null });
  return json({ user: userOf(req) });
}
